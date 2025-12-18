const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');

const { directories } = require('../config');
const { ensureDir, pathExists } = require('../utils/fsUtils');
const {
  combineRelativePath,
  ensureValidName,
  findAvailableName,
  normalizeRelativePath,
  parsePathSpace,
  getUserRootDir,
} = require('../utils/pathUtils');
const { resolvePathWithAccess } = require('./accessManager');
const { getDb } = require('./db');
const {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} = require('../errors/AppError');

const TRASH_DIR_NAME = '.TrashNE';

const generateId = () => (
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`
);

const safeTrashBasename = (id, name) => {
  const fallback = 'item';
  const safeName = (() => {
    try {
      return ensureValidName(name);
    } catch (_) {
      return fallback;
    }
  })();
  return `${id}__${safeName}`;
};

const computePreferredTrashDir = (resolved, context) => {
  if (resolved.space === 'personal') {
    const userRoot = getUserRootDir(context.user);
    return path.join(userRoot, TRASH_DIR_NAME);
  }

  if (resolved.space === 'volume') {
    if (resolved.userVolume && resolved.userVolume.path) {
      return path.join(resolved.userVolume.path, TRASH_DIR_NAME);
    }

    const rel = typeof resolved.relativePath === 'string' ? resolved.relativePath : '';
    const [volumeName] = rel.split('/').filter(Boolean);
    if (!volumeName) {
      throw new ValidationError('Cannot determine volume root for trash.');
    }
    const volumeRoot = path.join(directories.volume, volumeName);
    return path.join(volumeRoot, TRASH_DIR_NAME);
  }

  throw new ValidationError('Trash is only supported for volume and personal paths.');
};

const ensureTrashDir = async (trashDirAbsolute) => {
  await ensureDir(trashDirAbsolute);
  return trashDirAbsolute;
};

const moveEntry = async (sourcePath, destinationPath, isDirectory) => {
  try {
    await fs.rename(sourcePath, destinationPath);
  } catch (error) {
    if (error.code !== 'EXDEV') {
      throw error;
    }

    if (isDirectory) {
      if (typeof fs.cp === 'function') {
        await fs.cp(sourcePath, destinationPath, {
          recursive: true,
          force: false,
          errorOnExist: true,
        });
      } else {
        await ensureDir(destinationPath);
        const entries = await fs.readdir(sourcePath, { withFileTypes: true });
        for (const entry of entries) {
          const src = path.join(sourcePath, entry.name);
          const dest = path.join(destinationPath, entry.name);
          // eslint-disable-next-line no-await-in-loop
          await moveEntry(src, dest, entry.isDirectory());
        }
      }
      await fs.rm(sourcePath, { recursive: true, force: true });
      return;
    }

    await fs.copyFile(sourcePath, destinationPath);
    await fs.rm(sourcePath, { force: true });
  }
};

const insertTrashItem = async (record) => {
  const db = await getDb();
  const stmt = db.prepare(`
    INSERT INTO trash_items (
      id,
      deleted_by,
      source_path,
      source_parent,
      source_name,
      source_space,
      trash_absolute_path,
      is_directory,
      size,
      deleted_at,
      status
    ) VALUES (
      @id,
      @deletedBy,
      @sourcePath,
      @sourceParent,
      @sourceName,
      @sourceSpace,
      @trashAbsolutePath,
      @isDirectory,
      @size,
      @deletedAt,
      'trashed'
    )
  `);
  stmt.run(record);
};

const trashResolvedPath = async ({ resolved, name, context }) => {
  if (!context?.user?.id) {
    throw new ForbiddenError('Authentication required to move items to trash.');
  }

  const stats = await fs.stat(resolved.absolutePath);
  const isDirectory = stats.isDirectory();
  const size = isDirectory ? null : stats.size;

  const id = generateId();

  // Try to use the preferred trash dir (volume/personal root). If we can't create it,
  // fall back to a sibling `.TrashNE` in the source parent directory.
  const preferredTrashDir = computePreferredTrashDir(resolved, context);
  let trashDirAbsolute = preferredTrashDir;
  try {
    await ensureTrashDir(trashDirAbsolute);
  } catch (error) {
    if (!['EACCES', 'EPERM'].includes(error.code)) {
      throw error;
    }
    trashDirAbsolute = path.join(path.dirname(resolved.absolutePath), TRASH_DIR_NAME);
    await ensureTrashDir(trashDirAbsolute);
  }

  const trashBasename = safeTrashBasename(id, name);
  const trashAbsolutePath = path.join(trashDirAbsolute, trashBasename);
  if (await pathExists(trashAbsolutePath)) {
    throw new ValidationError('Trash destination already exists.');
  }

  await moveEntry(resolved.absolutePath, trashAbsolutePath, isDirectory);

  const sourcePath = normalizeRelativePath(resolved.relativePath);
  const sourceParent = normalizeRelativePath(path.posix.dirname(sourcePath));
  const sourceSpace = parsePathSpace(sourcePath).space;

  const deletedAt = new Date().toISOString();
  await insertTrashItem({
    id,
    deletedBy: String(context.user.id),
    sourcePath,
    sourceParent: sourceParent === '.' ? '' : sourceParent,
    sourceName: name,
    sourceSpace,
    trashAbsolutePath,
    isDirectory: isDirectory ? 1 : 0,
    size,
    deletedAt,
  });

  return {
    id,
    sourcePath,
    sourceParent: sourceParent === '.' ? '' : sourceParent,
    sourceName: name,
    sourceSpace,
    trashAbsolutePath,
    isDirectory,
    size,
    deletedAt,
  };
};

const listTrashItems = async (userId) => {
  if (!userId) {
    throw new ForbiddenError('Authentication required');
  }
  const db = await getDb();
  const rows = db.prepare(`
    SELECT
      id,
      source_path AS sourcePath,
      source_parent AS sourceParent,
      source_name AS sourceName,
      source_space AS sourceSpace,
      is_directory AS isDirectory,
      size,
      deleted_at AS deletedAt,
      trash_absolute_path AS trashAbsolutePath
    FROM trash_items
    WHERE deleted_by = ? AND status = 'trashed'
    ORDER BY deleted_at DESC
  `).all(String(userId));

  return rows.map((row) => ({
    id: row.id,
    name: row.sourceName,
    originalPath: row.sourcePath,
    originalParent: row.sourceParent,
    space: row.sourceSpace,
    isDirectory: Boolean(row.isDirectory),
    size: row.size ?? null,
    deletedAt: row.deletedAt,
    trashAbsolutePath: row.trashAbsolutePath,
  }));
};

const restoreTrashItem = async (trashId, context) => {
  if (!context?.user?.id) {
    throw new ForbiddenError('Authentication required');
  }

  if (typeof trashId !== 'string' || !trashId.trim()) {
    throw new ValidationError('Trash item id is required.');
  }

  const db = await getDb();
  const record = db.prepare(`
    SELECT
      id,
      deleted_by AS deletedBy,
      source_path AS sourcePath,
      source_parent AS sourceParent,
      source_name AS sourceName,
      trash_absolute_path AS trashAbsolutePath,
      is_directory AS isDirectory,
      status
    FROM trash_items
    WHERE id = ? AND deleted_by = ?
  `).get(trashId, String(context.user.id));

  if (!record || record.status !== 'trashed') {
    throw new NotFoundError('Trash item not found.');
  }

  const parentLogical = normalizeRelativePath(record.sourceParent || '');
  const desiredName = record.sourceName;

  const { accessInfo: parentAccess, resolved: parentResolved } = await resolvePathWithAccess(context, parentLogical);
  if (!parentAccess?.canAccess || !parentAccess.canWrite || !parentResolved) {
    throw new ForbiddenError(parentAccess?.denialReason || 'Cannot restore to this location.');
  }

  await ensureDir(parentResolved.absolutePath);

  const availableName = await findAvailableName(parentResolved.absolutePath, desiredName);
  const targetAbsolutePath = path.join(parentResolved.absolutePath, availableName);
  const restoredPath = combineRelativePath(parentLogical, availableName);

  const isDirectory = Boolean(record.isDirectory);
  await moveEntry(record.trashAbsolutePath, targetAbsolutePath, isDirectory);

  const restoredAt = new Date().toISOString();
  db.prepare(`
    UPDATE trash_items
    SET status = 'restored', restored_at = ?, restored_path = ?
    WHERE id = ?
  `).run(restoredAt, restoredPath, record.id);

  return {
    id: record.id,
    restoredPath,
    restoredAt,
    name: availableName,
  };
};

module.exports = {
  TRASH_DIR_NAME,
  trashResolvedPath,
  listTrashItems,
  restoreTrashItem,
};

