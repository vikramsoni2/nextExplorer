const path = require('path');
const fs = require('fs/promises');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');

const logger = require('../utils/logger');
const { archives } = require('../config/index');

const execFileAsync = promisify(execFile);

// Whitelist of extensions the app may offer for extraction, provided the
// local 7-Zip build actually supports them (checked against `7z i` at
// startup). Configurable through ARCHIVE_EXTENSIONS (see config/index.js).
const CANDIDATE_EXTENSIONS = Array.isArray(archives?.extensions) ? archives.extensions : ['zip'];

// Compound extensions that decompress to an inner tar archive. 7-Zip only
// peels one layer per run, so these need a second pass on the produced .tar.
const TAR_WRAPPER_EXTENSIONS = new Set(['gz', 'tgz', 'bz2', 'tbz2', 'xz', 'txz', 'zst', 'z']);

const SEVEN_ZIP_BIN = process.env.SEVEN_ZIP_PATH || '7z';

let supportedExtensionsPromise = null;

/**
 * Probe the local 7-Zip once and derive the extraction formats it supports.
 * `7z i` lists every compiled-in format with its extensions, so this stays
 * accurate across builds (e.g. Alpine builds that ship without the RAR codec).
 * Falls back to plain .zip (handled by the bundled JS extractor) when 7-Zip
 * is not installed at all.
 */
const probeSupportedExtensions = async () => {
  try {
    const { stdout } = await execFileAsync(SEVEN_ZIP_BIN, ['i'], {
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    const listed = new Set(
      stdout
        .toLowerCase()
        .split('\n')
        .flatMap((line) => line.split(/\s+/))
        .filter((token) => /^[a-z0-9]{1,5}$/.test(token))
    );
    const supported = CANDIDATE_EXTENSIONS.filter((ext) => listed.has(ext));
    // Compound tarball extensions piggy-back on the base codec being present.
    if (listed.has('gzip') || listed.has('gz')) supported.push('tgz');
    if (listed.has('bzip2')) supported.push('tbz2');
    if (listed.has('xz')) supported.push('txz');
    const unique = [...new Set(supported)];
    logger.info({ bin: SEVEN_ZIP_BIN, extensions: unique }, 'Archive extraction formats detected');
    return unique;
  } catch (error) {
    logger.warn(
      { bin: SEVEN_ZIP_BIN, err: error?.message },
      '7-Zip unavailable; archive extraction limited to .zip'
    );
    return ['zip'];
  }
};

const getSupportedArchiveExtensions = () => {
  if (!supportedExtensionsPromise) {
    supportedExtensionsPromise = probeSupportedExtensions();
  }
  return supportedExtensionsPromise;
};

const isSevenZipAvailable = async () => {
  const extensions = await getSupportedArchiveExtensions();
  // The zip-only fallback list means the probe failed.
  return !(extensions.length === 1 && extensions[0] === 'zip');
};

/**
 * Base name an extracted folder should take for a given archive filename:
 * strips the archive extension, plus the inner `.tar` of compound tarballs
 * (backup.tar.gz -> backup).
 */
const archiveBaseName = (filename) => {
  const ext = path.extname(filename).slice(1).toLowerCase();
  let base = path.basename(filename, path.extname(filename));
  if (TAR_WRAPPER_EXTENSIONS.has(ext) && base.toLowerCase().endsWith('.tar')) {
    base = base.slice(0, -4);
  }
  return base || 'Archive';
};

const EXTRACT_TIMEOUT_MS = 30 * 60 * 1000;
const EXTRACT_SIZE_POLL_MS = 2000;

const createSizeLimitError = () => {
  const error = new Error('This archive expands beyond the allowed size and was not extracted.');
  error.code = 'ARCHIVE_TOO_LARGE';
  return error;
};

const createCancellationError = () => {
  const error = new Error('Operation cancelled.');
  error.code = 'OPERATION_CANCELLED';
  return error;
};

const ARCHIVE_PASSWORD_ERROR_PATTERN =
  /wrong password|(?:enter|password).*(?:password|required|incorrect)|can not open encrypted archive|data error in encrypted file|headers error/i;

const normalizeArchivePassword = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    const error = new Error('Invalid archive password.');
    error.code = 'INVALID_ARCHIVE_PASSWORD';
    throw error;
  }
  // Control characters are exactly what must not reach the extractor prompt.
  // eslint-disable-next-line no-control-regex
  if (value.length > 4096 || /[\x00-\x1F\x7F]/.test(value)) {
    const error = new Error('Invalid archive password.');
    error.code = 'INVALID_ARCHIVE_PASSWORD';
    throw error;
  }
  return value;
};

const isArchivePasswordError = (error) =>
  ARCHIVE_PASSWORD_ERROR_PATTERN.test(String(error?.message || ''));

const createArchivePasswordError = (passwordProvided) => {
  const error = new Error(
    passwordProvided ? 'Incorrect archive password or corrupted archive.' : 'Archive password required.'
  );
  error.code = passwordProvided ? 'ARCHIVE_INVALID_PASSWORD' : 'ARCHIVE_PASSWORD_REQUIRED';
  return error;
};

const throwIfCancelled = (signal) => {
  if (signal?.aborted) throw createCancellationError();
};

const appendOutput = (current, chunk) => `${current}${chunk}`.slice(-4000);

const reportProgress = (chunk, onPercent) => {
  if (typeof onPercent !== 'function') return;
  const matches = String(chunk).match(/(\d{1,3})%/g);
  if (!matches?.length) return;
  const percent = Number.parseInt(matches[matches.length - 1], 10);
  if (Number.isFinite(percent)) onPercent(Math.min(100, Math.max(0, percent)));
};

const commandErrorFromOutput = (code, output, passwordProvided) => {
  const error = new Error(`7z exited with code ${code}: ${output.trim().slice(-500)}`);
  return isArchivePasswordError(error) ? createArchivePasswordError(passwordProvided) : error;
};

// When no -p switch is supplied, 7-Zip asks its controlling terminal for the
// password. A PTY lets us answer that prompt while keeping the secret out of
// argv, process listings and logs.
const runSevenZipWithPassword = (args, onPercent, options = {}) =>
  new Promise((resolve, reject) => {
    const { signal, cwd, password } = options;
    if (signal?.aborted) {
      reject(createCancellationError());
      return;
    }

    let pty;
    try {
      // Loaded lazily so archive extraction still works when the terminal
      // feature is disabled at the UI level.
      pty = require('@homebridge/node-pty-prebuilt-multiarch');
    } catch (error) {
      reject(error);
      return;
    }

    const child = pty.spawn(SEVEN_ZIP_BIN, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    let outputTail = '';
    let passwordWritten = false;
    let settled = false;
    let killTimer = null;
    const cleanup = () => {
      signal?.removeEventListener('abort', abort);
      if (killTimer) clearTimeout(killTimer);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const abort = () => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
      finish(reject, createCancellationError());
    };

    child.onData((chunk) => {
      outputTail = appendOutput(outputTail, chunk);
      reportProgress(chunk, onPercent);
      if (!passwordWritten && /enter password/i.test(outputTail)) {
        passwordWritten = true;
        child.write(`${password}\r`);
      }
    });
    child.onExit(({ exitCode }) => {
      if (signal?.aborted) {
        finish(reject, createCancellationError());
      } else if (exitCode === 0) {
        onPercent?.(100);
        finish(resolve);
      } else {
        finish(reject, commandErrorFromOutput(exitCode, outputTail, true));
      }
    });
    signal?.addEventListener('abort', abort, { once: true });
  });

/**
 * Run one 7-Zip command. `-bsp1` sends the percentage indicator to stdout, so
 * progress can be parsed from the output stream and forwarded to the caller
 * (0-100 per run).
 */
const runSevenZip = (args, onPercent, options = {}) =>
  new Promise((resolve, reject) => {
    const { signal, cwd, password } = options;
    if (password !== null && password !== undefined) {
      runSevenZipWithPassword(args, onPercent, options).then(resolve, reject);
      return;
    }
    if (signal?.aborted) {
      reject(createCancellationError());
      return;
    }

    const child = spawn(SEVEN_ZIP_BIN, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: EXTRACT_TIMEOUT_MS,
    });

    let outputTail = '';
    let settled = false;
    let killTimer = null;
    const cleanup = () => {
      signal?.removeEventListener('abort', abort);
      if (killTimer) clearTimeout(killTimer);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const abort = () => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
      finish(reject, createCancellationError());
    };

    child.stdout.on('data', (chunk) => {
      outputTail = appendOutput(outputTail, chunk);
      reportProgress(chunk, onPercent);
    });

    child.stderr.on('data', (chunk) => {
      outputTail = appendOutput(outputTail, chunk);
    });

    child.on('error', (error) => finish(reject, error));
    child.on('close', (code) => {
      if (signal?.aborted) {
        finish(reject, createCancellationError());
        return;
      }
      if (code === 0) {
        onPercent?.(100);
        finish(resolve);
      } else {
        finish(reject, commandErrorFromOutput(code, outputTail, false));
      }
    });
    signal?.addEventListener('abort', abort, { once: true });
  });

const runSevenZipExtract = (
  archiveAbsolutePath,
  destinationAbsolutePath,
  onPercent,
  options = {}
) =>
  runSevenZip(
    // -snl- keeps 7-Zip from restoring symbolic links. Path confinement is a
    // string comparison, so a link like `evil -> /` inside a tar would make
    // every later access step outside the volume while still looking valid.
    ['x', '-y', '-bsp1', '-snl-', `-o${destinationAbsolutePath}`, '--', archiveAbsolutePath],
    onPercent,
    options
  );

/**
 * Create a .zip archive from the given absolute paths, reporting progress
 * through `onPercent(0-100)`. 7-Zip stores each entry under its base name,
 * matching the behaviour of the previous in-memory implementation — but the
 * archive is streamed to disk instead of being assembled in the Node heap.
 */
const createZipArchive = (sourcePaths, zipAbsolutePath, onPercent, options = {}) =>
  runSevenZip(
    // `--` keeps the source names operands: callers pass file names straight
    // from the volume, and 7-Zip would read a leading dash as a switch
    // (`-sdel` deletes the sources, `@list` reads paths from a file).
    ['a', '-tzip', '-y', '-bsp1', zipAbsolutePath, '--', ...sourcePaths],
    onPercent,
    options
  );

/**
 * Extract an archive into the given (existing, empty) destination folder,
 * reporting overall progress through `onPercent(0-100)`. Compound tarballs
 * are peeled in two passes (each mapped to half of the progress range); the
 * intermediate .tar is removed so the folder holds the real content.
 */
/**
 * Total uncompressed size and entry count declared by an archive.
 *
 * `7z l -slt` lists without extracting, so an archive that would expand far
 * beyond its own size can be refused before a single byte is written. The
 * password is deliberately NOT passed here: it would land in argv (and in
 * process listings), and an encrypted archive simply reports no footprint —
 * which the caller handles by watching the extraction instead.
 *
 * Returns null whenever the listing is unusable (encrypted headers, timeout,
 * output larger than the buffer, unknown layout).
 */
const readArchiveFootprint = async (archiveAbsolutePath) => {
  try {
    const { stdout } = await execFileAsync(
      SEVEN_ZIP_BIN,
      ['l', '-slt', '-y', '--', archiveAbsolutePath],
      { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }
    );
    let totalBytes = 0;
    let entryCount = 0;
    for (const line of stdout.split('\n')) {
      const match = /^Size\s*=\s*(\d+)\s*$/.exec(line.trim());
      if (match) {
        totalBytes += Number.parseInt(match[1], 10) || 0;
        entryCount += 1;
      }
    }
    return entryCount ? { totalBytes, entryCount } : null;
  } catch (error) {
    return null;
  }
};

/** Bytes currently held under a directory, following no symlink. */
const directorySize = async (absolutePath) => {
  let total = 0;
  const stack = [absolutePath];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(child);
      } else if (entry.isFile()) {
        try {
          total += (await fs.lstat(child)).size;
        } catch {
          // The file may already be gone; it simply does not count.
        }
      }
    }
  }
  return total;
};

/**
 * Abort an extraction that outgrows `maxBytes` while it runs.
 *
 * The declared footprint is the cheap check, but it is unavailable for
 * encrypted or oversized listings — exactly the archives worth guarding
 * against. Watching what actually lands on disk covers those, plus the second
 * pass of compound tarballs and any archive that under-reports its own size.
 */
const watchExtractionSize = (destinationAbsolutePath, maxBytes, onExceeded) => {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return () => {};
  let stopped = false;
  const timer = setInterval(async () => {
    if (stopped) return;
    const written = await directorySize(destinationAbsolutePath);
    if (!stopped && written > maxBytes) {
      stopped = true;
      onExceeded(written);
    }
  }, EXTRACT_SIZE_POLL_MS);
  // Never hold the process open for the sake of this watcher.
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
};


/**
 * Reject an extraction that produced a symbolic link.
 *
 * `-snl-` already tells 7-Zip not to restore links, but this is the check
 * that actually protects the volume boundary, so it does not rely on a
 * single switch of an external tool.
 */
const assertNoSymlinks = async (rootAbsolutePath) => {
  const stack = [rootAbsolutePath];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        const error = new Error('This archive contains symbolic links and was not extracted.');
        error.code = 'ARCHIVE_CONTAINS_SYMLINK';
        throw error;
      }
      if (entry.isDirectory()) stack.push(path.join(current, entry.name));
    }
  }
};

const extractArchive = async (
  archiveAbsolutePath,
  destinationAbsolutePath,
  onPercent,
  options = {}
) => {
  const { signal, password = null, maxBytes = 0 } = options;
  throwIfCancelled(signal);
  const ext = path.extname(archiveAbsolutePath).slice(1).toLowerCase();
  const isCompound = TAR_WRAPPER_EXTENSIONS.has(ext);

  // The watcher cancels through the same signal path as a user cancellation,
  // so a partial extraction is cleaned up exactly like an aborted one.
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });
  let sizeExceeded = false;
  const stopWatching = watchExtractionSize(destinationAbsolutePath, maxBytes, () => {
    sizeExceeded = true;
    controller.abort();
  });

  try {
    await runSevenZipExtract(
      archiveAbsolutePath,
      destinationAbsolutePath,
      isCompound ? (p) => onPercent?.(Math.round(p / 2)) : onPercent,
      { signal: controller.signal, password }
    );

    if (isCompound) {
      throwIfCancelled(controller.signal);
      const entries = await fs.readdir(destinationAbsolutePath);
      if (entries.length === 1 && entries[0].toLowerCase().endsWith('.tar')) {
        const innerTar = path.join(destinationAbsolutePath, entries[0]);
        await runSevenZipExtract(
          innerTar,
          destinationAbsolutePath,
          (p) => onPercent?.(50 + Math.round(p / 2)),
          { signal: controller.signal, password }
        );
        await fs.rm(innerTar, { force: true });
      } else {
        onPercent?.(100);
      }
    }
    // The periodic watcher misses anything that finishes between two polls,
    // so the decisive check is this one, once everything is on disk.
    if (Number.isFinite(maxBytes) && maxBytes > 0) {
      const written = await directorySize(destinationAbsolutePath);
      if (written > maxBytes) throw createSizeLimitError();
    }

    await assertNoSymlinks(destinationAbsolutePath);
  } catch (error) {
    // A cancellation raised by the watcher is really a size refusal.
    if (sizeExceeded) throw createSizeLimitError();
    throw error;
  } finally {
    stopWatching();
    signal?.removeEventListener('abort', forwardAbort);
  }
};

module.exports = {
  getSupportedArchiveExtensions,
  isSevenZipAvailable,
  readArchiveFootprint,
  extractArchive,
  createZipArchive,
  archiveBaseName,
  normalizeArchivePassword,
  isArchivePasswordError,
};
