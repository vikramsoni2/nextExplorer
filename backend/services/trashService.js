const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');

const { directories, excludedFiles } = require('../config/index');
const { ensureDir, pathExists } = require('../utils/fsUtils');
const {
  normalizeRelativePath,
  resolveVolumePath,
  resolveItemPaths,
  combineRelativePath,
  findAvailableName,
  findAvailableFolderName,
} = require('../utils/pathUtils');
const logger = require('../utils/logger');

const TRASH_DIRNAME = '.trash';
const TRASH_ITEMS_DIRNAME = 'items';
const META_FILENAME = 'meta.json';

const generateTrashId = () => crypto.randomBytes(16).toString('hex');

const getVolumeNameFromRelativePath = (relativePath = '') => {
  const rel = normalizeRelativePath(relativePath || '');
  const segments = rel.split('/').filter(Boolean);
  return segments[0] || null;
};

const getVolumeTrashItemsRoot = async (volumeName) => {
  if (!volumeName) {
    throw new Error('Cannot resolve volume for trash entry.');
  }

  const volumeRoot = path.join(directories.volume, volumeName);
  const trashRoot = path.join(volumeRoot, TRASH_DIRNAME);
  const itemsRoot = path.join(trashRoot, TRASH_ITEMS_DIRNAME);
  await ensureDir(itemsRoot);
  return itemsRoot;
};

const moveEntry = async (sourcePath, destinationPath, isDirectory) => {
  try {
    await fs.rename(sourcePath, destinationPath);
  } catch (error) {
    if (error.code === 'EXDEV') {
      // Cross-device move: fall back to copy + delete
      if (isDirectory && typeof fs.cp === 'function') {
        await fs.cp(sourcePath, destinationPath, {
          recursive: true,
          force: false,
          errorOnExist: true,
        });
      } else if (isDirectory) {
        // Node.js < 16.7 without fs.cp: manual recursive copy
        await ensureDir(destinationPath);
        const entries = await fs.readdir(sourcePath, { withFileTypes: true });
        for (const entry of entries) {
          const src = path.join(sourcePath, entry.name);
          const dest = path.join(destinationPath, entry.name);
          // eslint-disable-next-line no-await-in-loop
          await moveEntry(src, dest, entry.isDirectory());
        }
      } else {
        await fs.copyFile(sourcePath, destinationPath);
      }

      await fs.rm(sourcePath, { recursive: isDirectory, force: true });
    } else {
      throw error;
    }
  }
};

const moveItemsToTrash = async (items = []) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('At least one item is required.');
  }

  const results = [];

  // Move each item into a per-volume, per-entry trash folder with metadata.
  for (const item of items) {
    try {
      const { relativePath, absolutePath } = resolveItemPaths(item);
      if (!(await pathExists(absolutePath))) {
        results.push({ path: relativePath, status: 'missing' });
        continue;
      }

      const stats = await fs.stat(absolutePath);
      const volumeName = getVolumeNameFromRelativePath(relativePath);

      if (!volumeName) {
        throw new Error(`Could not determine volume for path: ${relativePath}`);
      }

      const itemsRoot = await getVolumeTrashItemsRoot(volumeName);

      const trashId = generateTrashId();
      const entryDir = path.join(itemsRoot, trashId);
      await ensureDir(entryDir);

      const originalName = path.basename(relativePath);
      const trashedItemPath = path.join(entryDir, originalName);

      await moveEntry(absolutePath, trashedItemPath, stats.isDirectory());

      const originalParent = (() => {
        const segments = relativePath.split('/').filter(Boolean);
        if (segments.length <= 1) {
          return volumeName;
        }
        return segments.slice(0, -1).join('/');
      })();

      const meta = {
        id: trashId,
        volume: volumeName,
        originalRelativePath: relativePath,
        originalName,
        originalParent,
        isDirectory: stats.isDirectory(),
        size: stats.size,
        deletedAt: new Date().toISOString(),
      };

      await fs.writeFile(
        path.join(entryDir, META_FILENAME),
        JSON.stringify(meta, null, 2),
        'utf8',
      );

      results.push({ path: relativePath, status: 'trashed', id: trashId });
    } catch (error) {
      logger.error({ err: error, item }, 'Failed to move item to trash');
      let rel = '';
      try {
        rel = resolveItemPaths(item).relativePath;
      } catch {
        rel = item?.path || '';
      }
      results.push({ path: rel, status: 'error', error: error.message });
    }
  }

  return results;
};

const findTrashEntryById = async (id) => {
  if (!id) return null;

  const entries = await fs.readdir(directories.volume, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (excludedFiles.includes(entry.name)) continue;

    const volumeName = entry.name;
    const itemsRoot = path.join(
      directories.volume,
      volumeName,
      TRASH_DIRNAME,
      TRASH_ITEMS_DIRNAME,
    );

    if (!(await pathExists(itemsRoot))) continue;

    const candidate = path.join(itemsRoot, id);
    if (await pathExists(candidate)) {
      return { volume: volumeName, itemsRoot, entryDir: candidate };
    }
  }

  return null;
};

const listTrashItems = async () => {
  const items = [];

  const volumes = await fs.readdir(directories.volume, { withFileTypes: true });

  for (const vol of volumes) {
    if (!vol.isDirectory()) continue;
    if (excludedFiles.includes(vol.name)) continue;

    const volumeName = vol.name;
    const itemsRoot = path.join(
      directories.volume,
      volumeName,
      TRASH_DIRNAME,
      TRASH_ITEMS_DIRNAME,
    );

    if (!(await pathExists(itemsRoot))) continue;

    let trashEntries;
    try {
      trashEntries = await fs.readdir(itemsRoot, { withFileTypes: true });
    } catch (error) {
      logger.warn({ err: error, volume: volumeName }, 'Failed to read trash items directory');
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    for (const entry of trashEntries) {
      if (!entry.isDirectory()) continue;
      const trashId = entry.name;
      const entryDir = path.join(itemsRoot, trashId);
      const metaPath = path.join(entryDir, META_FILENAME);

      let meta;
      try {
        // eslint-disable-next-line no-await-in-loop
        const raw = await fs.readFile(metaPath, 'utf8');
        meta = JSON.parse(raw);
      } catch (error) {
        logger.warn({ err: error, entryDir }, 'Failed to read trash metadata');
        // Skip malformed entries
        // eslint-disable-next-line no-continue
        continue;
      }

      const name = meta.originalName || trashId;
      const trashedItemPath = path.join(entryDir, name);

      let stats = null;
      try {
        // eslint-disable-next-line no-await-in-loop
        stats = await fs.stat(trashedItemPath);
      } catch (error) {
        // Item missing but metadata present; keep entry but with size 0
        logger.warn({ err: error, trashedItemPath }, 'Failed to stat trashed item');
      }

      const isDirectory = stats ? stats.isDirectory() : Boolean(meta.isDirectory);
      const size = stats?.size ?? (meta.size || 0);

      let kind;
      if (isDirectory) {
        kind = 'directory';
      } else {
        const extension = path.extname(name).slice(1).toLowerCase();
        kind = extension.length > 10 ? 'unknown' : extension || 'unknown';
      }

      items.push({
        id: meta.id || trashId,
        name,
        volume: meta.volume || volumeName,
        kind,
        size,
        deletedAt: meta.deletedAt || null,
        originalRelativePath: meta.originalRelativePath
          || combineRelativePath(volumeName, name),
        originalParent: meta.originalParent || volumeName,
      });
    }
  }

  items.sort((a, b) => {
    const aTime = a.deletedAt ? Date.parse(a.deletedAt) : 0;
    const bTime = b.deletedAt ? Date.parse(b.deletedAt) : 0;
    return bTime - aTime;
  });

  return items;
};

const restoreTrashItems = async (ids = []) => {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error('At least one id is required.');
  }

  const results = [];

  for (const id of ids) {
    try {
      const entry = await findTrashEntryById(id);
      if (!entry) {
        results.push({ id, status: 'missing' });
        // eslint-disable-next-line no-continue
        continue;
      }

      const metaPath = path.join(entry.entryDir, META_FILENAME);
      const raw = await fs.readFile(metaPath, 'utf8');
      const meta = JSON.parse(raw);

      const volumeName = meta.volume || entry.volume;
      const originalName = meta.originalName;
      const trashedItemPath = path.join(entry.entryDir, originalName);

      let restoreParentRelative = meta.originalParent || volumeName;
      let restoreParentAbsolute = resolveVolumePath(restoreParentRelative);

      if (!(await pathExists(restoreParentAbsolute))) {
        // If original parent no longer exists, fall back to volume root
        restoreParentRelative = normalizeRelativePath(volumeName);
        restoreParentAbsolute = resolveVolumePath(restoreParentRelative);
        await ensureDir(restoreParentAbsolute);
      }

      const stats = await fs.stat(trashedItemPath);
      const availableName = stats.isDirectory()
        ? await findAvailableFolderName(restoreParentAbsolute, originalName)
        : await findAvailableName(restoreParentAbsolute, originalName);

      const targetAbsolute = path.join(restoreParentAbsolute, availableName);
      const targetRelative = combineRelativePath(restoreParentRelative, availableName);

      await moveEntry(trashedItemPath, targetAbsolute, stats.isDirectory());
      await fs.rm(entry.entryDir, { recursive: true, force: true });

      results.push({ id, status: 'restored', path: targetRelative });
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to restore trash entry');
      results.push({ id, status: 'error', error: error.message });
    }
  }

  return results;
};

const deleteTrashItems = async (ids = []) => {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error('At least one id is required.');
  }

  const results = [];

  for (const id of ids) {
    try {
      const entry = await findTrashEntryById(id);
      if (!entry) {
        results.push({ id, status: 'missing' });
        // eslint-disable-next-line no-continue
        continue;
      }

      await fs.rm(entry.entryDir, { recursive: true, force: true });
      results.push({ id, status: 'deleted' });
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to permanently delete trash entry');
      results.push({ id, status: 'error', error: error.message });
    }
  }

  return results;
};

module.exports = {
  moveItemsToTrash,
  listTrashItems,
  restoreTrashItems,
  deleteTrashItems,
};

