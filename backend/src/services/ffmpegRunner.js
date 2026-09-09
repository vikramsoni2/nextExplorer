const fs = require('fs');
const { spawn, execFile } = require('child_process');

const env = require('../config/env');
const logger = require('../utils/logger');

/**
 * Running ffmpeg and ffprobe, directly.
 *
 * This replaces `fluent-ffmpeg`, which is deprecated on npm with no successor
 * and was used for seven calls, every one of them "start a process and read its
 * output" — something four other places in this codebase already do plainly
 * (`pdftotext`, `rg`, `7z`, `rsync`). A builder API is a poor trade for a
 * dependency nobody maintains sitting on the path that produces every
 * thumbnail.
 *
 * Two things it does that the library did and are easy to lose: it resolves the
 * binaries once at startup rather than trusting `PATH`, and it hands back the
 * child process so a caller can register it, lower its priority and kill it.
 */

const CANDIDATES = {
  ffmpeg: [env.FFMPEG_PATH, '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg'],
  ffprobe: [
    env.FFPROBE_PATH,
    '/usr/local/bin/ffprobe',
    '/usr/bin/ffprobe',
    '/opt/homebrew/bin/ffprobe',
  ],
};

/**
 * The first candidate that exists and can be run.
 *
 * An absolute path rather than a bare name on purpose: `PATH` is inherited from
 * whatever started the process, and a file manager running as root should not
 * be resolving its tools through it.
 */
const resolveExecutable = (candidates) => {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (_) {
      // Try the next one.
    }
  }
  return null;
};

const ffmpegPath = resolveExecutable(CANDIDATES.ffmpeg);
const ffprobePath = resolveExecutable(CANDIDATES.ffprobe);

if (!ffmpegPath) {
  logger.warn('FFmpeg binary not found. Video thumbnails will be skipped.');
}

/** Whether ffmpeg is available at all. */
const hasFfmpeg = () => Boolean(ffmpegPath);

/** Whether ffprobe is available at all. */
const hasFfprobe = () => Boolean(ffprobePath);

const PROBE_TIMEOUT_MS = 30_000;
const PROBE_MAX_BUFFER = 4 * 1024 * 1024;

/**
 * What ffprobe says about a file, as the object it prints.
 *
 * Answers null rather than throwing for every failure — a missing binary, an
 * unreadable file, a container ffprobe does not know. Every caller here treats
 * "no information" the same way, and turning that into an exception would only
 * move the shrug somewhere less obvious.
 *
 * @returns {Promise<{format?: object, streams?: object[]}|null>}
 */
const probe = (filePath) =>
  new Promise((resolve) => {
    if (!ffprobePath) {
      resolve(null);
      return;
    }

    execFile(
      ffprobePath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-show_format',
        '-show_streams',
        '-print_format',
        'json',
        '--',
        filePath,
      ],
      { timeout: PROBE_TIMEOUT_MS, maxBuffer: PROBE_MAX_BUFFER },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          resolve(parsed && typeof parsed === 'object' ? parsed : null);
        } catch (_) {
          resolve(null);
        }
      }
    );
  });

/**
 * Start ffmpeg with the given arguments, writing to stdout.
 *
 * The child is handed back rather than hidden, because the caller registers it
 * for cancellation and lowers its scheduling priority — a thumbnail must never
 * be the reason a listing is slow.
 *
 * @returns {import('child_process').ChildProcess}
 */
const run = (args) => {
  if (!ffmpegPath) {
    throw new Error('FFmpeg binary not found.');
  }
  return spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
};

module.exports = {
  hasFfmpeg,
  hasFfprobe,
  probe,
  run,
  ffmpegPath,
  ffprobePath,
};
