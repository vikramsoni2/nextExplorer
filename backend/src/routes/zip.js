const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const AdmZip = require('adm-zip');

const asyncHandler = require('../utils/asyncHandler');
const { mapWithConcurrency } = require('../utils/mapWithConcurrency');
const { startNdjsonStream, throttlePercent } = require('../utils/ndjsonStream');
const logger = require('../utils/logger');
const { pathExists } = require('../utils/fsUtils');
const {
  normalizeRelativePath,
  combineRelativePath,
  ensureValidName,
  findAvailableFolderName,
  findAvailableName,
} = require('../utils/pathUtils');
const { ValidationError, ForbiddenError, NotFoundError } = require('../errors/AppError');
const { ACTIONS, authorizeAndResolve } = require('../services/authorizationService');
const {
  getSupportedArchiveExtensions,
  isSevenZipAvailable,
  readArchiveFootprint,
  extractArchive,
  createZipArchive,
  archiveBaseName,
  normalizeArchivePassword,
} = require('../services/archiveService');
const { archives } = require('../config/index');

const router = express.Router();

/**
 * Refuse archives that would expand far beyond their own size.
 *
 * Extraction is otherwise unbounded: a few kilobytes of nested, highly
 * compressible entries can fill the volume ("zip bomb"). The declared sizes
 * come from the archive itself, so this is a cheap pre-flight check, not a
 * guarantee — it stops the accidental and the trivially malicious case.
 */
const ensureArchiveWithinLimits = ({ entryCount = 0, totalBytes = 0 }) => {
  if (entryCount > archives.maxEntries) {
    throw new ValidationError(
      `This archive holds more than ${archives.maxEntries} entries and was not extracted.`
    );
  }
  if (totalBytes > archives.maxExtractedBytes) {
    throw new ValidationError(
      'This archive expands beyond the allowed size and was not extracted.'
    );
  }
};

/** Declared footprint of a zip read by the bundled JS extractor. */
const admZipFootprint = (entries = []) => ({
  entryCount: entries.length,
  totalBytes: entries.reduce((total, entry) => total + (entry?.header?.size || 0), 0),
});

const buildItemMetadata = async (absolutePath, relativeParent, name) => {
  const stats = await fs.stat(absolutePath);
  const ext = path.extname(name).slice(1).toLowerCase();
  const kind = stats.isDirectory() ? 'directory' : ext.length > 10 ? 'unknown' : ext || 'unknown';

  return { name, path: relativeParent, kind, size: stats.size, dateModified: stats.mtime };
};

const defaultZipNameForItems = (items = []) => {
  if (!Array.isArray(items) || items.length === 0) return 'Archive.zip';
  if (items.length > 1) return 'Archive.zip';

  const { name = '', kind = '' } = items[0] || {};
  if (!name) return 'Archive.zip';

  if (String(kind).toLowerCase() === 'directory') return `${name}.zip`;

  const ext = path.extname(name);
  return `${ext ? name.slice(0, -ext.length) : name}.zip`;
};

const extractIntoCurrentFolder = async ({
  stagingDirectory,
  destinationDirectory,
  relativeParentPath,
  movedPaths,
}) => {
  const stagedEntries = await fs.readdir(stagingDirectory, { withFileTypes: true });
  const items = [];

  for (const entry of stagedEntries) {
    const entryName = ensureValidName(entry.name);
    const destinationName = await findAvailableName(destinationDirectory, entryName);
    const sourcePath = path.join(stagingDirectory, entryName);
    const destinationPath = path.join(destinationDirectory, destinationName);

    await fs.rename(sourcePath, destinationPath);
    movedPaths.push(destinationPath);

    items.push(await buildItemMetadata(destinationPath, relativeParentPath, destinationName));
  }

  return items;
};

router.post(
  '/files/zip/extract',
  asyncHandler(async (req, res) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const onClose = () => {
      if (!res.writableEnded) abort();
    };
    req.once('aborted', abort);
    res.once('close', onClose);
    const inputPath = req.body?.path ?? '';
    const destination = req.body?.destination ?? 'folder';
    const archivePassword = normalizeArchivePassword(req.body?.password);
    if (typeof inputPath !== 'string' || !inputPath.trim()) {
      throw new ValidationError('An archive file path is required.');
    }
    if (destination !== 'folder' && destination !== 'current') {
      throw new ValidationError('Invalid archive extraction destination.');
    }

    const relativePath = normalizeRelativePath(inputPath);
    const context = { user: req.user, guestSession: req.guestSession };

    const { allowed, accessInfo, resolved } = await authorizeAndResolve(
      context,
      relativePath,
      ACTIONS.read
    ).catch(() => {
      throw new NotFoundError('File not found.');
    });
    if (!allowed || !resolved) {
      throw new ForbiddenError(accessInfo?.denialReason || 'Access denied.');
    }

    const zipAbsolutePath = resolved.absolutePath;
    if (!(await pathExists(zipAbsolutePath))) throw new NotFoundError('File not found.');

    const stats = await fs.stat(zipAbsolutePath);
    if (!stats.isFile()) throw new ValidationError('Only archive files can be extracted.');

    const archiveExtension = path.extname(zipAbsolutePath).slice(1).toLowerCase();
    const supportedExtensions = await getSupportedArchiveExtensions();
    if (!supportedExtensions.includes(archiveExtension)) {
      throw new ValidationError(
        `Unsupported archive format ".${archiveExtension}". Supported: ${supportedExtensions
          .map((ext) => `.${ext}`)
          .join(', ')}.`
      );
    }

    const parentRelativePath = normalizeRelativePath(
      path.posix.dirname(resolved.relativePath || '')
    );
    const {
      allowed: parentAllowed,
      accessInfo: parentAccessInfo,
      resolved: parentResolved,
    } = await authorizeAndResolve(context, parentRelativePath, ACTIONS.createFolder);
    if (!parentAllowed || !parentResolved) {
      throw new ForbiddenError(parentAccessInfo?.denialReason || 'Destination is read-only.');
    }

    const { allowed: filesAllowed, accessInfo: filesAccessInfo } = await authorizeAndResolve(
      context,
      parentRelativePath,
      ACTIONS.write
    );
    if (!filesAllowed) {
      throw new ForbiddenError(filesAccessInfo?.denialReason || 'Destination is read-only.');
    }

    const parentAbsolutePath = parentResolved?.absolutePath;
    if (!parentAbsolutePath) throw new ForbiddenError('Cannot resolve destination folder.');

    const parentStats = await fs.stat(parentAbsolutePath);
    if (!parentStats.isDirectory()) throw new ValidationError('Destination must be a directory.');

    const baseFolderName = (() => {
      try {
        return ensureValidName(archiveBaseName(path.basename(zipAbsolutePath)));
      } catch (_) {
        return 'Archive';
      }
    })();

    const folderName =
      destination === 'folder'
        ? await findAvailableFolderName(parentAbsolutePath, baseFolderName)
        : baseFolderName;
    const destinationFolderAbsolutePath =
      destination === 'folder'
        ? path.join(parentAbsolutePath, folderName)
        : await fs.mkdtemp(path.join(parentAbsolutePath, '.nextexplorer-extract-'));
    const movedPaths = [];

    if (destination === 'folder') {
      await fs.mkdir(destinationFolderAbsolutePath);
    }

    // Everything above throws BEFORE any byte is written, so validation errors
    // still surface as normal HTTP errors. From here on the response streams
    // NDJSON progress events, mirroring the copy/move endpoints:
    //   {type:'start',    name}
    //   {type:'progress', percent}    (throttled)
    //   {type:'done',     success, item}
    //   {type:'error',    message, code}
    const writeEvent = startNdjsonStream(res);

    writeEvent({ type: 'start', name: folderName });

    const onPercent = throttlePercent(writeEvent);

    try {
      if (await isSevenZipAvailable()) {
        // Listing first means an archive that would expand beyond the limits
        // is refused before anything is written to disk.
        // Cheap pre-flight when the archive declares a usable listing...
        const footprint = await readArchiveFootprint(zipAbsolutePath);
        if (footprint) ensureArchiveWithinLimits(footprint);
        // 7-Zip streams to disk, so large archives don't get buffered in RAM.
        // ...and a running guard for everything else: encrypted archives,
        // listings too large to parse, and the second pass of tarballs.
        await extractArchive(zipAbsolutePath, destinationFolderAbsolutePath, onPercent, {
          signal: controller.signal,
          password: archivePassword,
          maxBytes: archives.maxExtractedBytes,
        });
      } else {
        const fallbackZip = new AdmZip(zipAbsolutePath);
        ensureArchiveWithinLimits(admZipFootprint(fallbackZip.getEntries()));
        fallbackZip.extractAllTo(destinationFolderAbsolutePath, true);
        if (controller.signal.aborted) {
          const error = new Error('Operation cancelled.');
          error.code = 'OPERATION_CANCELLED';
          throw error;
        }
      }

      if (destination === 'folder') {
        const item = await buildItemMetadata(
          destinationFolderAbsolutePath,
          parentRelativePath,
          folderName
        );
        writeEvent({ type: 'done', success: true, item, items: [item] });
      } else {
        // Extract to a private sibling first, then move each root entry into the
        // current folder. This avoids partial writes and lets us apply the same
        // collision rule used everywhere else: name, name (1), name (2), ...
        const items = await extractIntoCurrentFolder({
          stagingDirectory: destinationFolderAbsolutePath,
          destinationDirectory: parentAbsolutePath,
          relativeParentPath: parentRelativePath,
          movedPaths,
        });
        await fs.rm(destinationFolderAbsolutePath, { recursive: true, force: true });
        writeEvent({
          type: 'done',
          success: true,
          item: items.length === 1 ? items[0] : null,
          items,
        });
      }
    } catch (error) {
      const isPasswordError =
        error?.code === 'ARCHIVE_PASSWORD_REQUIRED' || error?.code === 'ARCHIVE_INVALID_PASSWORD';
      if (isPasswordError) {
        logger.info({ zipAbsolutePath, code: error.code }, 'Archive password required or rejected');
      } else {
        logger.warn(
          { zipAbsolutePath, err: error },
          'Archive extract failed; cleaning up destination'
        );
      }
      await fs.rm(destinationFolderAbsolutePath, { recursive: true, force: true });
      await mapWithConcurrency(movedPaths, (movedPath) =>
        fs.rm(movedPath, { recursive: true, force: true })
      );
      writeEvent({
        type: 'error',
        message: error.message || 'Archive extraction failed.',
        code: error.code || 'EXTRACT_FAILED',
      });
    } finally {
      req.off('aborted', abort);
      res.off('close', onClose);
      res.end();
    }
  })
);

router.post(
  '/files/zip/compress',
  asyncHandler(async (req, res) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const onClose = () => {
      if (!res.writableEnded) abort();
    };
    req.once('aborted', abort);
    res.once('close', onClose);
    const { items = [], destination = '', name } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      throw new ValidationError('At least one item is required.');
    }

    const normalizedDestination = normalizeRelativePath(destination || items[0]?.path || '');

    if (!normalizedDestination.trim()) {
      throw new ValidationError(
        'Cannot create archives in the root path. Please select a specific volume or folder first.'
      );
    }

    const context = { user: req.user, guestSession: req.guestSession };
    const {
      allowed: destAllowed,
      accessInfo: destAccess,
      resolved: destResolved,
    } = await authorizeAndResolve(context, normalizedDestination, ACTIONS.write);
    if (!destAllowed || !destResolved) {
      throw new ForbiddenError(destAccess?.denialReason || 'Destination is read-only.');
    }

    const destinationAbsolutePath = destResolved.absolutePath;
    const destStats = await fs.stat(destinationAbsolutePath);
    if (!destStats.isDirectory()) throw new ValidationError('Destination must be a directory.');

    // The list came in the request; the number of checks in flight is ours.
    const sourceTargets = await mapWithConcurrency(items, async (item) => {
      if (!item || typeof item.name !== 'string') {
        throw new ValidationError('Each item must include a name.');
      }
      const itemParent = normalizeRelativePath(item.path || '');
      const itemRelative = combineRelativePath(itemParent, item.name);
      const { allowed, accessInfo, resolved } = await authorizeAndResolve(
        context,
        itemRelative,
        ACTIONS.read
      );
      if (!allowed || !resolved) {
        throw new ForbiddenError(accessInfo?.denialReason || 'Source item is not accessible.');
      }

      const stats = await fs.stat(resolved.absolutePath);
      return { name: item.name, absolutePath: resolved.absolutePath, stats };
    });

    const requestedName = (() => {
      if (typeof name === 'string' && name.trim()) {
        const cleaned = ensureValidName(name.trim());
        return cleaned.toLowerCase().endsWith('.zip') ? cleaned : `${cleaned}.zip`;
      }
      return defaultZipNameForItems(items);
    })();

    const zipFileName = await findAvailableName(destinationAbsolutePath, requestedName);
    const zipAbsolutePath = path.join(destinationAbsolutePath, zipFileName);

    // Everything above throws BEFORE any byte is written, so validation errors
    // still surface as normal HTTP errors. From here on the response streams
    // NDJSON progress events, mirroring the extract endpoint:
    //   {type:'start',    name}
    //   {type:'progress', percent}    (throttled)
    //   {type:'done',     success, item}
    //   {type:'error',    message, code}
    const writeEvent = startNdjsonStream(res);

    writeEvent({ type: 'start', name: zipFileName });

    const onPercent = throttlePercent(writeEvent);

    try {
      if (await isSevenZipAvailable()) {
        // 7-Zip streams the archive to disk instead of assembling it in RAM.
        const sourceParent = path.dirname(sourceTargets[0].absolutePath);
        const hasCommonParent = sourceTargets.every(
          ({ absolutePath }) => path.dirname(absolutePath) === sourceParent
        );
        await createZipArchive(
          hasCommonParent
            ? sourceTargets.map(({ name }) => name)
            : sourceTargets.map(({ absolutePath }) => absolutePath),
          zipAbsolutePath,
          onPercent,
          { signal: controller.signal, cwd: hasCommonParent ? sourceParent : undefined }
        );
      } else {
        const zip = new AdmZip();
        sourceTargets.forEach(({ name: entryName, absolutePath, stats }) => {
          stats.isDirectory()
            ? zip.addLocalFolder(absolutePath, entryName)
            : zip.addLocalFile(absolutePath, '', entryName);
        });
        zip.writeZip(zipAbsolutePath);
        if (controller.signal.aborted) {
          const error = new Error('Operation cancelled.');
          error.code = 'OPERATION_CANCELLED';
          throw error;
        }
      }

      const item = await buildItemMetadata(zipAbsolutePath, normalizedDestination, zipFileName);
      writeEvent({ type: 'done', success: true, item });
    } catch (error) {
      logger.warn({ zipAbsolutePath, err: error }, 'Archive creation failed; cleaning up file');
      await fs.rm(zipAbsolutePath, { force: true });
      writeEvent({
        type: 'error',
        message: error.message || 'Archive creation failed.',
        code: error.code || 'COMPRESS_FAILED',
      });
    } finally {
      req.off('aborted', abort);
      res.off('close', onClose);
      res.end();
    }
  })
);

module.exports = router;
