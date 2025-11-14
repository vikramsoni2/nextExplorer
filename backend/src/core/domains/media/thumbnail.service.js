/**
 * Thumbnail Service
 * Generate and serve thumbnails for images and videos
 */

const path = require('path');
const crypto = require('crypto');
const fs = require('fs').promises;
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const logger = require('../../../shared/logger/logger');
const config = require('../../../shared/config');

// Configure sharp
const currentConcurrency = sharp.concurrency();
sharp.concurrency(Math.max(1, Math.min(8, currentConcurrency)));
sharp.cache({ memory: 256, files: 0 });

class ThumbnailService {
  constructor({ fileSystemService, settingsService }) {
    this.fileSystemService = fileSystemService;
    this.settingsService = settingsService;
    this.thumbnailsDir = config.directories.thumbnails;
    this.inflight = new Map();
    this.canProcessVideo = false;

    this.configureFfmpeg();
  }

  /**
   * Configure ffmpeg binaries
   */
  configureFfmpeg() {
    const candidates = {
      ffmpeg: [
        process.env.FFMPEG_PATH,
        '/usr/local/bin/ffmpeg',
        '/usr/bin/ffmpeg',
        '/opt/homebrew/bin/ffmpeg',
      ],
      ffprobe: [
        process.env.FFPROBE_PATH,
        '/usr/local/bin/ffprobe',
        '/usr/bin/ffprobe',
        '/opt/homebrew/bin/ffprobe',
      ],
    };

    const ffmpegPath = this.resolveExecutable(candidates.ffmpeg);
    const ffprobePath = this.resolveExecutable(candidates.ffprobe);

    if (ffmpegPath) {
      ffmpeg.setFfmpegPath(ffmpegPath);
    } else {
      logger.warn('FFmpeg binary not found. Video thumbnails will be disabled.');
    }

    if (ffprobePath) {
      ffmpeg.setFfprobePath(ffprobePath);
    } else {
      logger.warn('ffprobe binary not found. Video thumbnails will be disabled.');
    }

    this.canProcessVideo = Boolean(ffmpegPath && ffprobePath);
  }

  /**
   * Resolve executable path
   */
  resolveExecutable(candidates) {
    const fsSync = require('fs');
    for (const candidate of candidates) {
      if (!candidate) continue;

      try {
        fsSync.accessSync(candidate, fsSync.constants.X_OK);
        return candidate;
      } catch (error) {
        // Try next candidate
      }
    }
    return null;
  }

  /**
   * Get thumbnail settings
   */
  async getThumbnailSettings() {
    const settings = await this.settingsService.getGlobalSettings();
    return {
      size: settings?.thumbnails?.size || 200,
      quality: settings?.thumbnails?.quality || 70,
      enabled: settings?.thumbnails?.enabled !== false
    };
  }

  /**
   * Generate hash for file (for caching)
   */
  async hashForFile(absolutePath) {
    const stats = await fs.stat(absolutePath);
    const hash = crypto.createHash('sha1');
    hash.update(absolutePath);
    hash.update(String(stats.size));
    hash.update(String(Math.floor(stats.mtimeMs)));
    return hash.digest('hex');
  }

  /**
   * Build thumbnail paths
   */
  async buildThumbnailPaths(absolutePath) {
    const key = await this.hashForFile(absolutePath);
    const thumbFile = `${key}.webp`;
    const thumbPath = path.join(this.thumbnailsDir, thumbFile);
    return { thumbFile, thumbPath };
  }

  /**
   * Atomic write for thumbnail
   */
  async atomicWrite(finalPath, buffer) {
    // Ensure directory exists
    await fs.mkdir(path.dirname(finalPath), { recursive: true });

    const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmpPath, buffer);
    await fs.rename(tmpPath, finalPath);
  }

  /**
   * Generate image thumbnail
   */
  async makeImageThumb(srcPath, destPath) {
    const { size, quality } = await this.getThumbnailSettings();

    const buffer = await sharp(srcPath)
      .resize({
        width: size,
        height: size,
        fit: 'inside',
        withoutEnlargement: true,
        fastShrinkOnLoad: true,
      })
      .webp({ quality, effort: 4 })
      .toBuffer();

    await this.atomicWrite(destPath, buffer);
  }

  /**
   * Probe video duration
   */
  async probeDuration(filePath) {
    return new Promise((resolve) => {
      ffmpeg.ffprobe(filePath, (error, data) => {
        if (error || !data?.format?.duration) {
          resolve(null);
          return;
        }
        resolve(Number(data.format.duration) || null);
      });
    });
  }

  /**
   * Generate video thumbnail
   */
  async makeVideoThumb(srcPath, destPath) {
    if (!this.canProcessVideo) {
      logger.warn({ srcPath }, 'Skipping video thumbnail (no ffmpeg/ffprobe)');
      return;
    }

    const duration = await this.probeDuration(srcPath);
    const seconds = duration && Number.isFinite(duration)
      ? Math.max(1, Math.floor(duration * 0.05))
      : 1;

    const { size, quality } = await this.getThumbnailSettings();

    await new Promise((resolve, reject) => {
      const command = ffmpeg(srcPath)
        .inputOptions(['-hide_banner', '-loglevel', 'error'])
        .seekInput(seconds)
        .outputOptions(['-frames:v', '1', '-vf', `scale=${size}:-1:flags=lanczos`, '-vcodec', 'png'])
        .format('image2pipe')
        .on('error', reject);

      const stream = command.pipe();
      stream.on('error', reject);

      const pipeline = sharp().webp({ quality, effort: 4 });
      stream.pipe(pipeline);

      pipeline
        .toBuffer()
        .then((buffer) => this.atomicWrite(destPath, buffer))
        .then(resolve)
        .catch(reject);
    });
  }

  /**
   * Generate thumbnail
   */
  async generateThumbnail(absolutePath, thumbPath) {
    const ext = path.extname(absolutePath).toLowerCase().slice(1);

    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff'];
    const videoExts = ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg'];

    if (imageExts.includes(ext)) {
      await this.makeImageThumb(absolutePath, thumbPath);
      return;
    }

    if (videoExts.includes(ext)) {
      await this.makeVideoThumb(absolutePath, thumbPath);
      return;
    }

    throw new Error(`Unsupported file type: .${ext}`);
  }

  /**
   * Get thumbnail (generate if not exists)
   */
  async getThumbnail(relativePath) {
    // Check if thumbnails are enabled
    const { enabled } = await this.getThumbnailSettings();
    if (!enabled) {
      return null;
    }

    // Skip if path includes thumbnails directory
    if (relativePath.includes('thumbnails')) {
      return null;
    }

    const ext = path.extname(relativePath).toLowerCase().slice(1);

    // Skip PDFs
    if (ext === 'pdf') {
      return null;
    }

    const absolutePath = this.fileSystemService.resolvePath(relativePath);
    const { thumbFile, thumbPath } = await this.buildThumbnailPaths(absolutePath);

    const createOrReuse = async () => {
      try {
        // Check if thumbnail exists
        await fs.access(thumbPath);
        return `/static/thumbnails/${thumbFile}`;
      } catch (error) {
        // Generate thumbnail
        await this.generateThumbnail(absolutePath, thumbPath);

        // Verify it was created
        try {
          await fs.access(thumbPath);
          return `/static/thumbnails/${thumbFile}`;
        } catch (missing) {
          return null;
        }
      }
    };

    // Use inflight map to prevent duplicate generation
    let pending = this.inflight.get(thumbPath);
    if (!pending) {
      pending = createOrReuse().finally(() => this.inflight.delete(thumbPath));
      this.inflight.set(thumbPath, pending);
    }

    return pending;
  }

  /**
   * Check if thumbnail exists (without generating)
   */
  async getThumbnailPathIfExists(relativePath) {
    if (relativePath.includes('thumbnails')) {
      return null;
    }

    const ext = path.extname(relativePath).toLowerCase().slice(1);
    if (ext === 'pdf') {
      return null;
    }

    const absolutePath = this.fileSystemService.resolvePath(relativePath);
    const { thumbFile, thumbPath } = await this.buildThumbnailPaths(absolutePath);

    try {
      await fs.access(thumbPath);
      return `/static/thumbnails/${thumbFile}`;
    } catch (error) {
      return null;
    }
  }

  /**
   * Queue thumbnail generation in background
   */
  queueThumbnailGeneration(relativePath) {
    if (!relativePath || relativePath.includes('thumbnails')) {
      return;
    }

    const ext = path.extname(relativePath).toLowerCase().slice(1);
    if (ext === 'pdf') {
      return;
    }

    this.getThumbnail(relativePath).catch((error) => {
      logger.warn({ relativePath, error: error.message }, 'Queued thumbnail generation failed');
    });
  }
}

module.exports = ThumbnailService;
