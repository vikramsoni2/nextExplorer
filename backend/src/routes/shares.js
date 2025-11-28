const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const bcrypt = require('bcryptjs');
const archiver = require('archiver');

const { normalizeRelativePath, resolveLogicalPath } = require('../utils/pathUtils');
const { pathExists } = require('../utils/fsUtils');
const { excludedFiles, extensions } = require('../config/index');
const { getSettings } = require('../services/settingsService');
const { getPermissionForPath } = require('../services/accessControlService');
const {
  createShare,
  getShareById,
  listSharesForOwner,
  upsertShareUser,
  listShareUsers,
  deleteShareUser,
  deleteShare,
  toClientShare,
  toClientShareUser,
} = require('../services/shareService');
const { getById: getUserById } = require('../services/users');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');
const {
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
} = require('../errors/AppError');

const router = express.Router();

const previewable = new Set([
  ...extensions.images,
  ...extensions.videos,
  ...(extensions.documents || []),
]);

const ensureAuth = (req) => {
  if (!req.user || !req.user.id) {
    throw new UnauthorizedError();
  }
  return req.user;
};

const isShareExpired = (share) => {
  if (!share || !share.link_expires_at) return false;
  const ts = Date.parse(share.link_expires_at);
  if (!Number.isFinite(ts)) return false;
  return Date.now() > ts;
};

// Create a new share for a single file or folder
router.post('/shares', asyncHandler(async (req, res) => {
  const user = ensureAuth(req);
  const {
    path: rawPath,
    mode,
    type,
    label,
    password,
    expiresAt,
  } = req.body || {};

  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    throw new ValidationError('A path is required to create a share.');
  }

  const inputRelative = normalizeRelativePath(rawPath);

  let resolved;
  try {
    resolved = resolveLogicalPath(inputRelative, { user });
  } catch (error) {
    logger.warn({ path: rawPath, err: error }, 'Failed to resolve share path');
    throw new NotFoundError('Path not found.');
  }

  const { absolutePath, relativePath } = resolved;

  if (!(await pathExists(absolutePath))) {
    throw new NotFoundError('Path not found.');
  }

  const stats = await fs.stat(absolutePath);

  let inferredType = stats.isDirectory() ? 'directory' : 'file';
  if (type === 'directory' && !stats.isDirectory()) {
    throw new ValidationError('The specified path is not a directory.');
  }
  if (type === 'file' && !stats.isFile()) {
    throw new ValidationError('The specified path is not a file.');
  }
  if (type === 'directory' || type === 'file') {
    inferredType = type;
  }

  // Respect access control rules; hidden paths cannot be shared.
  const perm = await getPermissionForPath(relativePath || '');
  if (perm === 'hidden') {
    throw new ForbiddenError('This path cannot be shared.');
  }

  const linkMode = mode === 'rw' ? 'rw' : 'ro';

  let linkRequiresPassword = false;
  let linkPasswordHash = null;
  let linkPasswordSalt = null;
  if (typeof password === 'string' && password.length > 0) {
    linkRequiresPassword = true;
    // bcrypt includes its own salt; we store it in hash for now.
    linkPasswordHash = bcrypt.hashSync(password, 12);
  }

  let linkExpiresAt = null;
  if (expiresAt !== undefined && expiresAt !== null && expiresAt !== '') {
    if (typeof expiresAt !== 'string') {
      throw new ValidationError('Expiry must be an ISO-8601 string.');
    }
    const ts = Date.parse(expiresAt);
    if (!Number.isFinite(ts)) {
      throw new ValidationError('Invalid expiry date format.');
    }
    linkExpiresAt = new Date(ts).toISOString();
  }

  const shareRow = await createShare({
    ownerUserId: user.id,
    path: relativePath,
    itemType: inferredType,
    linkMode,
    label: typeof label === 'string' ? label.trim() || null : null,
    linkRequiresPassword,
    linkPasswordHash,
    linkPasswordSalt,
    linkExpiresAt,
  });

  res.status(201).json({
    success: true,
    share: toClientShare(shareRow),
    // Convenience: link that the UI can show to the user
    link: `/share/${shareRow.id}/`,
  });
}));

// List shares owned by current user
router.get('/shares', asyncHandler(async (req, res) => {
  const user = ensureAuth(req);
  const rows = await listSharesForOwner(user.id);
  res.json({
    shares: rows.map(toClientShare),
  });
}));

// Get a single share by id (owner-only)
router.get('/shares/:shareId', asyncHandler(async (req, res) => {
  const user = ensureAuth(req);
  const { shareId } = req.params;
  const share = await getShareById(shareId);

  if (!share || share.owner_user_id !== user.id) {
    throw new NotFoundError('Share not found.');
  }

  res.json({
    share: toClientShare(share),
  });
}));

// Delete a share (owner-only)
router.delete('/shares/:shareId', asyncHandler(async (req, res) => {
  const user = ensureAuth(req);
  const { shareId } = req.params;

  const ok = await deleteShare(shareId, user.id);
  if (!ok) {
    throw new NotFoundError('Share not found.');
  }

  res.json({ success: true });
}));

// List per-user access entries for a share (owner-only)
router.get('/shares/:shareId/users', asyncHandler(async (req, res) => {
  const user = ensureAuth(req);
  const { shareId } = req.params;

  const share = await getShareById(shareId);
  if (!share || share.owner_user_id !== user.id) {
    throw new NotFoundError('Share not found.');
  }

  const rows = await listShareUsers(shareId);
  res.json({
    users: rows.map(toClientShareUser),
  });
}));

// Upsert a per-user access entry for a share (owner-only)
router.post('/shares/:shareId/users', asyncHandler(async (req, res) => {
  const user = ensureAuth(req);
  const { shareId } = req.params;
  const {
    userId,
    accessMode,
    expiresAt,
  } = req.body || {};

  const share = await getShareById(shareId);
  if (!share || share.owner_user_id !== user.id) {
    throw new NotFoundError('Share not found.');
  }

  if (typeof userId !== 'string' || !userId.trim()) {
    throw new ValidationError('userId is required.');
  }

  let normalizedExpiresAt = null;
  if (expiresAt !== undefined && expiresAt !== null && expiresAt !== '') {
    if (typeof expiresAt !== 'string') {
      throw new ValidationError('Expiry must be an ISO-8601 string.');
    }
    const ts = Date.parse(expiresAt);
    if (!Number.isFinite(ts)) {
      throw new ValidationError('Invalid expiry date format.');
    }
    normalizedExpiresAt = new Date(ts).toISOString();
  }

  const row = await upsertShareUser({
    shareId,
    userId: userId.trim(),
    accessMode,
    expiresAt: normalizedExpiresAt,
  });

  res.status(201).json({
    user: toClientShareUser(row),
  });
}));

// Remove per-user access entry (owner-only)
router.delete('/shares/:shareId/users/:userId', asyncHandler(async (req, res) => {
  const user = ensureAuth(req);
  const { shareId, userId } = req.params;

  const share = await getShareById(shareId);
  if (!share || share.owner_user_id !== user.id) {
    throw new NotFoundError('Share not found.');
  }

  await deleteShareUser(shareId, userId);
  res.json({ success: true });
}));

// Browse inside a share. This is read-only and resolves to the underlying path.
router.get('/share/:shareId/browse/*', asyncHandler(async (req, res) => {
  const settings = await getSettings();
  const thumbsEnabled = settings?.thumbnails?.enabled !== false;

  const { shareId } = req.params;
  const innerRawPath = req.params[0] || '';
  const innerRelativePath = normalizeRelativePath(innerRawPath);

  const share = await getShareById(shareId);
  if (!share) {
    throw new NotFoundError('Share not found.');
  }

  if (isShareExpired(share)) {
    throw new NotFoundError('Share not found.');
  }

  // Resolve paths as the owner, so personal shares point into the owner's space,
  // not the viewer's.
  const ownerUser = share.owner_user_id ? await getUserById(share.owner_user_id) : null;
  const userForPath = ownerUser || null;

  const basePath = normalizeRelativePath(share.base_path);

  // File share: expose a virtual directory that contains only this file
  if (share.item_type === 'file') {
    if (innerRelativePath) {
      throw new NotFoundError('Path not found.');
    }

    const segments = basePath.split('/').filter(Boolean);
    const fileName = segments.pop();
    const parentRel = segments.join('/');

    let resolvedDir;
    try {
      resolvedDir = resolveLogicalPath(parentRel, { user: userForPath });
    } catch (error) {
      logger.warn({ shareId, path: parentRel, err: error }, 'Failed to resolve parent path for file share');
      throw new NotFoundError('Path not found.');
    }

    const directoryPath = resolvedDir.absolutePath;
    const relativeDirPath = resolvedDir.relativePath;
    const filePath = path.join(directoryPath, fileName);

    let stats;
    try {
      stats = await fs.stat(filePath);
    } catch (err) {
      if (['EPERM', 'EACCES', 'ENOENT'].includes(err?.code)) {
        logger.warn({ filePath, err }, 'Share file missing or unreadable');
        throw new NotFoundError('Path not found.');
      }
      throw err;
    }

    if (!stats.isFile()) {
      throw new NotFoundError('Path not found.');
    }

    const fullRel = relativeDirPath ? `${relativeDirPath}/${fileName}` : fileName;
    const perm = await getPermissionForPath(fullRel);
    if (perm === 'hidden') {
      throw new NotFoundError('Path not found.');
    }

    let extension = path.extname(fileName).slice(1).toLowerCase();
    if (extension.length > 10) {
      extension = 'unknown';
    }

    const item = {
      name: fileName,
      path: relativeDirPath,
      dateModified: stats.mtime,
      size: stats.size,
      kind: extension,
    };

    if (thumbsEnabled && previewable.has(extension.toLowerCase()) && extension !== 'pdf') {
      item.supportsThumbnail = true;
    }

    res.json([item]);
    return;
  }

  // Directory share
  const targetRelative = innerRelativePath
    ? `${basePath}/${innerRelativePath}`
    : basePath;

  let resolved;
  try {
    resolved = resolveLogicalPath(targetRelative, { user: userForPath });
  } catch (error) {
    logger.warn({ shareId, path: targetRelative, err: error }, 'Failed to resolve share browse path');
    throw new NotFoundError('Path not found.');
  }

  const { absolutePath: directoryPath, relativePath } = resolved;

  if (!(await pathExists(directoryPath))) {
    throw new NotFoundError('Path not found.');
  }

  const files = await fs.readdir(directoryPath);
  const filteredFiles = files
    .filter((file) => !excludedFiles.includes(file))
    .filter((file) => path.extname(file).toLowerCase() !== '.download');

  const fileDataPromises = filteredFiles.map(async (file) => {
    const filePath = path.join(directoryPath, file);
    let stats;
    try {
      stats = await fs.stat(filePath);
    } catch (err) {
      // Gracefully skip entries we cannot stat due to permissions or races
      if (['EPERM', 'EACCES', 'ENOENT'].includes(err?.code)) {
        logger.warn({ filePath, err }, 'Skipping unreadable entry in share browse');
        return null;
      }
      throw err;
    }

    let extension = stats.isDirectory()
      ? 'directory'
      : path.extname(file).slice(1).toLowerCase();

    if (extension.length > 10) {
      extension = 'unknown';
    }

    const item = {
      name: file,
      path: relativePath,
      dateModified: stats.mtime,
      size: stats.size,
      kind: extension,
    };

    // Enforce hidden rules in listings
    const fullRel = relativePath ? `${relativePath}/${file}` : file;
    const perm = await getPermissionForPath(fullRel);
    if (perm === 'hidden') {
      return null;
    }

    // Mark files that support thumbnails without blocking on existence checks
    if (thumbsEnabled && stats.isFile() && previewable.has(extension.toLowerCase()) && extension !== 'pdf') {
      item.supportsThumbnail = true;
    }

    return item;
  });

  const fileData = (await Promise.all(fileDataPromises)).filter(Boolean);
  res.json(fileData);
}));

// Download a single file from a share.
router.get('/share/:shareId/file/*', asyncHandler(async (req, res) => {
  const { shareId } = req.params;
  const innerRawPath = req.params[0] || '';
  const innerRelativePath = normalizeRelativePath(innerRawPath);

  const share = await getShareById(shareId);
  if (!share) {
    throw new NotFoundError('Share not found.');
  }

  if (isShareExpired(share)) {
    throw new NotFoundError('Share not found.');
  }

  const ownerUser = share.owner_user_id ? await getUserById(share.owner_user_id) : null;
  const userForPath = ownerUser || null;

  const basePath = normalizeRelativePath(share.base_path);

  let targetRelative;
  if (share.item_type === 'file') {
    const segments = basePath.split('/').filter(Boolean);
    const fileName = segments.pop();

    // Allow either empty inner path or the file name itself
    if (innerRelativePath && innerRelativePath !== fileName) {
      throw new NotFoundError('Path not found.');
    }

    targetRelative = basePath;
  } else {
    if (!innerRelativePath) {
      throw new NotFoundError('Path not found.');
    }
    targetRelative = `${basePath}/${innerRelativePath}`;
  }

  let resolved;
  try {
    resolved = resolveLogicalPath(targetRelative, { user: userForPath });
  } catch (error) {
    logger.warn({ shareId, path: targetRelative, err: error }, 'Failed to resolve share file path');
    throw new NotFoundError('Path not found.');
  }

  const { absolutePath, relativePath } = resolved;

  let stats;
  try {
    stats = await fs.stat(absolutePath);
  } catch (err) {
    if (['EPERM', 'EACCES', 'ENOENT'].includes(err?.code)) {
      logger.warn({ absolutePath, err }, 'Share download target missing or unreadable');
      throw new NotFoundError('Path not found.');
    }
    throw err;
  }

  if (!stats.isFile()) {
    throw new NotFoundError('Path not found.');
  }

  const perm = await getPermissionForPath(relativePath || '');
  if (perm === 'hidden') {
    throw new NotFoundError('Path not found.');
  }

  const filename = path.basename(absolutePath);
  res.download(absolutePath, filename, (err) => {
    if (err) {
      logger.error({ err }, 'Share file download failed');
      if (!res.headersSent) {
        res.status(500).send('Failed to download file.');
      }
    }
  });
}));

// Download multiple items from a share (files and/or folders).
router.post('/share/:shareId/download', asyncHandler(async (req, res) => {
  const { shareId } = req.params;
  const rawPaths = req.body?.paths;

  const inputPaths = [];
  if (Array.isArray(rawPaths)) {
    rawPaths.forEach((p) => {
      if (typeof p === 'string' && p.trim()) inputPaths.push(p);
    });
  } else if (typeof rawPaths === 'string' && rawPaths.trim()) {
    inputPaths.push(rawPaths);
  }

  if (inputPaths.length === 0) {
    throw new ValidationError('At least one path is required.');
  }

  const innerPaths = [...new Set(inputPaths.map((p) => normalizeRelativePath(p)).filter(Boolean))];

  const share = await getShareById(shareId);
  if (!share) {
    throw new NotFoundError('Share not found.');
  }
  if (isShareExpired(share)) {
    throw new NotFoundError('Share not found.');
  }

  const ownerUser = share.owner_user_id ? await getUserById(share.owner_user_id) : null;
  const userForPath = ownerUser || null;
  const basePath = normalizeRelativePath(share.base_path);

  const targets = await Promise.all(innerPaths.map(async (inner) => {
    const combinedRel = basePath ? `${basePath}/${inner}` : inner;
    const fullRel = normalizeRelativePath(combinedRel);

    let resolved;
    try {
      resolved = resolveLogicalPath(fullRel, { user: userForPath });
    } catch (error) {
      logger.warn({ shareId, path: fullRel, err: error }, 'Failed to resolve share download path');
      throw new NotFoundError('Path not found.');
    }

    const { absolutePath, relativePath } = resolved;
    let stats;
    try {
      stats = await fs.stat(absolutePath);
    } catch (err) {
      if (['EPERM', 'EACCES', 'ENOENT'].includes(err?.code)) {
        logger.warn({ absolutePath, err }, 'Share download target missing or unreadable');
        throw new NotFoundError('Path not found.');
      }
      throw err;
    }

    const perm = await getPermissionForPath(relativePath || '');
    if (perm === 'hidden') {
      throw new NotFoundError('Path not found.');
    }

    return {
      inner,
      absolutePath,
      stats,
    };
  }));

  if (targets.length === 0) {
    throw new NotFoundError('Path not found.');
  }

  const hasDirectory = targets.some(({ stats }) => stats.isDirectory());
  const shouldArchive = hasDirectory || targets.length > 1;

  if (!shouldArchive) {
    const { absolutePath } = targets[0];
    const filename = path.basename(absolutePath);
    res.download(absolutePath, filename, (err) => {
      if (err) {
        logger.error({ err }, 'Share file download failed');
        if (!res.headersSent) {
          res.status(500).send('Failed to download file.');
        }
      }
    });
    return;
  }

  const baseInner = normalizeRelativePath(req.body?.basePath || '');
  const archiveName = (() => {
    if (baseInner) {
      const segments = baseInner.split('/').filter(Boolean);
      const baseName = segments[segments.length - 1] || baseInner;
      return `${baseName}.zip`;
    }
    if (targets.length === 1) {
      const inner = targets[0].inner || '';
      const segments = inner.split('/').filter(Boolean);
      const baseName = segments[segments.length - 1] || inner;
      if (baseName) return `${baseName}.zip`;
    }
    return 'download.zip';
  })();

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${archiveName}"`);

  const archive = archiver('zip', { zlib: { level: 1 } });
  archive.on('error', (archiveError) => {
    logger.error({ err: archiveError }, 'Share archive creation failed');
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to create archive.' });
    } else {
      res.end();
    }
  });

  archive.pipe(res);

  targets.forEach(({ inner, absolutePath, stats }) => {
    const entryNameRaw = inner || path.basename(absolutePath);
    const entryName = entryNameRaw.replace(/\\/g, '/').replace(/^\/+/, '') || path.basename(absolutePath);

    if (stats.isDirectory()) {
      archive.directory(absolutePath, entryName);
    } else {
      archive.file(absolutePath, { name: entryName });
    }
  });

  await archive.finalize();
}));

module.exports = router;
