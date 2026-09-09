const path = require('path');
const fs = require('fs/promises');
const { normalizeRelativePath } = require('../../utils/pathUtils');
const { resolvePathWithAccess } = require('../../services/accessManager');
const { extensions } = require('../../config/index');
const ffmpegRunner = require('../../services/ffmpegRunner');
const mediaTracks = require('../../services/mediaTracks');
const asyncHandler = require('../../utils/asyncHandler');
const {
  ValidationError,
  ForbiddenError,
  NotFoundError,
  UnsupportedMediaTypeError,
} = require('../../errors/AppError');
const logger = require('../../utils/logger');
const { markLongPoll } = require('../../middleware/heldRequests');

const router = require('express').Router();

/**
 * What a video actually contains, and one subtitle track at a time.
 *
 * The player hands files straight to a `<video>` element and does not
 * transcode — that is a media server's job, not a file explorer's. These two
 * endpoints exist so that limit is stated rather than merely suffered: the
 * first says which tracks the browser will refuse and why, the second converts
 * a subtitle track into the one format a browser will display.
 */

/** Resolve a request's `path` to a readable media file the caller may see. */
const resolveMediaFile = async (req) => {
  const { path: relative = '' } = req.query || {};
  if (typeof relative !== 'string' || !relative) {
    throw new ValidationError('A file path is required.');
  }

  const relativePath = normalizeRelativePath(relative);
  const context = { user: req.user, guestSession: req.guestSession };
  const { accessInfo, resolved } = await resolvePathWithAccess(context, relativePath);

  if (!accessInfo || !accessInfo.canAccess || !accessInfo.canRead) {
    throw new ForbiddenError(accessInfo?.denialReason || 'Access not allowed.');
  }

  const { absolutePath } = resolved;
  const stats = await fs.stat(absolutePath);
  if (stats.isDirectory()) {
    throw new ValidationError('Not a media file.');
  }

  const extension = path.extname(absolutePath).slice(1).toLowerCase();
  const isMedia =
    extensions.videos.includes(extension) || (extensions.audios || []).includes(extension);
  if (!isMedia) {
    throw new UnsupportedMediaTypeError('Not a media file.');
  }

  return absolutePath;
};

/**
 * The tracks inside a media file.
 *
 * Answers the question a silent video raises. A file whose only soundtrack is
 * AC-3 plays perfectly with no sound in Chrome and Firefox, and nothing on
 * screen explains it; with this, the player can say which track it is and that
 * the browser cannot decode it, instead of leaving a person to conclude the
 * file is broken.
 */
router.get(
  '/media/tracks',
  asyncHandler(async (req, res) => {
    const absolutePath = await resolveMediaFile(req);

    if (!ffmpegRunner.hasFfprobe()) {
      // Without ffprobe there is nothing to report — say so plainly rather than
      // returning an empty inventory the player would read as "no subtitles".
      res.json({ available: false, video: [], audio: [], subtitles: [] });
      return;
    }

    const tracks = await mediaTracks.readMediaTracks(absolutePath);
    if (!tracks) {
      throw new UnsupportedMediaTypeError('Media could not be read.');
    }

    res.json({ available: true, ...tracks });
  })
);

/**
 * One subtitle track as WebVTT.
 *
 * Which track is named the way the inventory named it: `stream` for an index
 * ffprobe reported, `file` for a sidecar. A sidecar name is checked against the
 * enumeration rather than joined onto a path, so the only files reachable here
 * are the ones this endpoint itself would have offered.
 */
router.get(
  '/media/subtitle',
  asyncHandler(async (req, res) => {
    const absolutePath = await resolveMediaFile(req);
    const { stream, file } = req.query || {};

    // Pulling one subtitle track means demuxing the whole container, because
    // subtitle packets are interleaved from beginning to end. Measured at
    // seven to eighteen seconds for a 1080p episode on external storage —
    // slow, but the request is working, not stuck. Saying so keeps it out of
    // the held-request instrument, whose ten reports are spent for the life of
    // the process and are there for finding a server that really is wedged.
    markLongPoll(req);

    if (!ffmpegRunner.hasFfmpeg()) {
      throw new UnsupportedMediaTypeError('Subtitle conversion is not available.');
    }

    let source = absolutePath;
    let streamIndex = null;

    if (typeof file === 'string' && file) {
      const sidecars = await mediaTracks.findSidecarSubtitles(absolutePath);
      const match = sidecars.find((candidate) => candidate.fileName === file);
      if (!match) {
        throw new NotFoundError('No such subtitle file.');
      }
      source = path.join(path.dirname(absolutePath), match.fileName);
    } else if (stream !== undefined) {
      const index = Number(stream);
      if (!Number.isInteger(index) || index < 0) {
        throw new ValidationError('A subtitle stream index is required.');
      }

      const tracks = await mediaTracks.readMediaTracks(absolutePath);
      const match = (tracks?.subtitles || []).find(
        (candidate) => candidate.source === 'embedded' && candidate.index === index
      );
      if (!match) {
        throw new NotFoundError('No such subtitle track.');
      }
      if (!match.convertible) {
        // A Blu-ray or DVD subtitle is a picture of words. Turning it into text
        // needs OCR, which is a different piece of software entirely.
        throw new UnsupportedMediaTypeError(
          `Subtitles in ${match.codec} are images and cannot be converted to text.`
        );
      }
      streamIndex = index;
    } else {
      throw new ValidationError('A subtitle track must be named.');
    }

    let vtt;
    try {
      vtt = await mediaTracks.extractWebVtt(source, { streamIndex });
    } catch (error) {
      logger.warn({ absolutePath, source, streamIndex, err: error }, 'Subtitle conversion failed');
      throw new UnsupportedMediaTypeError('This subtitle track could not be converted.');
    }

    res.writeHead(200, {
      'Content-Type': 'text/vtt; charset=utf-8',
      'Content-Length': Buffer.byteLength(vtt),
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
    });
    res.end(vtt);
  })
);

module.exports = router;
