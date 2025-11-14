/**
 * Metadata Service
 * Extract metadata from images, videos, and other media files
 */

const { spawn } = require('child_process');
const path = require('path');
const logger = require('../../../shared/logger/logger');

class MetadataService {
  constructor({ fileSystemService }) {
    this.fileSystemService = fileSystemService;
    this.exiftoolAvailable = null;
    this.ffprobeAvailable = null;
  }

  /**
   * Check if exiftool is available
   */
  async isExiftoolAvailable() {
    if (this.exiftoolAvailable !== null) {
      return this.exiftoolAvailable;
    }

    return new Promise((resolve) => {
      const exiftool = spawn('exiftool', ['-ver']);

      exiftool.on('error', () => {
        this.exiftoolAvailable = false;
        logger.info('exiftool not available');
        resolve(false);
      });

      exiftool.on('close', (code) => {
        this.exiftoolAvailable = code === 0;
        if (this.exiftoolAvailable) {
          logger.info('exiftool available for metadata extraction');
        }
        resolve(this.exiftoolAvailable);
      });
    });
  }

  /**
   * Check if ffprobe is available
   */
  async isFfprobeAvailable() {
    if (this.ffprobeAvailable !== null) {
      return this.ffprobeAvailable;
    }

    return new Promise((resolve) => {
      const ffprobe = spawn('ffprobe', ['-version']);

      ffprobe.on('error', () => {
        this.ffprobeAvailable = false;
        logger.info('ffprobe not available');
        resolve(false);
      });

      ffprobe.on('close', (code) => {
        this.ffprobeAvailable = code === 0;
        if (this.ffprobeAvailable) {
          logger.info('ffprobe available for video metadata extraction');
        }
        resolve(this.ffprobeAvailable);
      });
    });
  }

  /**
   * Extract metadata from file
   */
  async extractMetadata(relativePath) {
    const absolutePath = this.fileSystemService.resolvePath(relativePath);
    const stats = await this.fileSystemService.stat(relativePath);
    const ext = path.extname(relativePath).toLowerCase();

    const metadata = {
      path: relativePath,
      name: path.basename(relativePath),
      size: stats.size,
      modified: stats.mtime,
      created: stats.birthtime,
      extension: ext.slice(1),
      type: this.getFileType(ext)
    };

    // Extract specific metadata based on file type
    if (this.isImageFile(ext)) {
      const imageMetadata = await this.extractImageMetadata(absolutePath);
      Object.assign(metadata, imageMetadata);
    } else if (this.isVideoFile(ext)) {
      const videoMetadata = await this.extractVideoMetadata(absolutePath);
      Object.assign(metadata, videoMetadata);
    }

    return metadata;
  }

  /**
   * Extract image metadata using exiftool
   */
  async extractImageMetadata(absolutePath) {
    const useExiftool = await this.isExiftoolAvailable();

    if (!useExiftool) {
      return {};
    }

    return new Promise((resolve) => {
      const exiftool = spawn('exiftool', ['-json', '-n', absolutePath]);
      let output = '';

      exiftool.stdout.on('data', (data) => {
        output += data.toString();
      });

      exiftool.on('error', (error) => {
        logger.error({ error, path: absolutePath }, 'exiftool execution error');
        resolve({});
      });

      exiftool.on('close', (code) => {
        if (code !== 0) {
          logger.warn({ code, path: absolutePath }, 'exiftool failed');
          resolve({});
          return;
        }

        try {
          const data = JSON.parse(output);
          const metadata = data[0] || {};

          const result = {};

          if (metadata.ImageWidth) result.width = metadata.ImageWidth;
          if (metadata.ImageHeight) result.height = metadata.ImageHeight;
          if (metadata.Make) result.cameraMake = metadata.Make;
          if (metadata.Model) result.cameraModel = metadata.Model;
          if (metadata.DateTimeOriginal) result.dateTaken = metadata.DateTimeOriginal;
          if (metadata.GPSLatitude && metadata.GPSLongitude) {
            result.gps = {
              latitude: metadata.GPSLatitude,
              longitude: metadata.GPSLongitude
            };
          }
          if (metadata.ISO) result.iso = metadata.ISO;
          if (metadata.FNumber) result.aperture = metadata.FNumber;
          if (metadata.ExposureTime) result.shutterSpeed = metadata.ExposureTime;
          if (metadata.FocalLength) result.focalLength = metadata.FocalLength;

          resolve(result);
        } catch (error) {
          logger.error({ error, output }, 'Failed to parse exiftool output');
          resolve({});
        }
      });
    });
  }

  /**
   * Extract video metadata using ffprobe
   */
  async extractVideoMetadata(absolutePath) {
    const useFfprobe = await this.isFfprobeAvailable();

    if (!useFfprobe) {
      return {};
    }

    return new Promise((resolve) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        absolutePath
      ]);

      let output = '';

      ffprobe.stdout.on('data', (data) => {
        output += data.toString();
      });

      ffprobe.on('error', (error) => {
        logger.error({ error, path: absolutePath }, 'ffprobe execution error');
        resolve({});
      });

      ffprobe.on('close', (code) => {
        if (code !== 0) {
          logger.warn({ code, path: absolutePath }, 'ffprobe failed');
          resolve({});
          return;
        }

        try {
          const data = JSON.parse(output);
          const result = {};

          // Duration from format
          if (data.format && data.format.duration) {
            result.duration = parseFloat(data.format.duration);
          }

          // Video stream info
          const videoStream = data.streams?.find(s => s.codec_type === 'video');
          if (videoStream) {
            result.width = videoStream.width;
            result.height = videoStream.height;
            result.codec = videoStream.codec_name;
            if (videoStream.r_frame_rate) {
              const [num, den] = videoStream.r_frame_rate.split('/');
              result.fps = parseFloat((parseInt(num) / parseInt(den)).toFixed(2));
            }
            if (videoStream.bit_rate) {
              result.bitrate = parseInt(videoStream.bit_rate);
            }
          }

          // Audio stream info
          const audioStream = data.streams?.find(s => s.codec_type === 'audio');
          if (audioStream) {
            result.audioCodec = audioStream.codec_name;
            result.audioChannels = audioStream.channels;
            result.audioSampleRate = audioStream.sample_rate;
          }

          resolve(result);
        } catch (error) {
          logger.error({ error, output }, 'Failed to parse ffprobe output');
          resolve({});
        }
      });
    });
  }

  /**
   * Get file type category
   */
  getFileType(ext) {
    if (this.isImageFile(ext)) return 'image';
    if (this.isVideoFile(ext)) return 'video';
    if (this.isAudioFile(ext)) return 'audio';
    if (this.isDocumentFile(ext)) return 'document';
    if (this.isArchiveFile(ext)) return 'archive';
    return 'file';
  }

  /**
   * Check if file is an image
   */
  isImageFile(ext) {
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.tiff', '.ico'];
    return imageExts.includes(ext.toLowerCase());
  }

  /**
   * Check if file is a video
   */
  isVideoFile(ext) {
    const videoExts = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg'];
    return videoExts.includes(ext.toLowerCase());
  }

  /**
   * Check if file is an audio file
   */
  isAudioFile(ext) {
    const audioExts = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a'];
    return audioExts.includes(ext.toLowerCase());
  }

  /**
   * Check if file is a document
   */
  isDocumentFile(ext) {
    const docExts = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf', '.odt'];
    return docExts.includes(ext.toLowerCase());
  }

  /**
   * Check if file is an archive
   */
  isArchiveFile(ext) {
    const archiveExts = ['.zip', '.tar', '.gz', '.bz2', '.7z', '.rar', '.xz'];
    return archiveExts.includes(ext.toLowerCase());
  }
}

module.exports = MetadataService;
