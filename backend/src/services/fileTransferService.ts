import path from 'path';
import fs from 'fs/promises';

import { ensureDir, pathExists } from '../utils/fsUtils';
import {
  normalizeRelativePath,
  resolveVolumePath,
  resolveItemPaths,
  combineRelativePath,
  findAvailableName,
  PathItem,
} from '../utils/pathUtils';

type TransferOperation = 'copy' | 'move';

const copyEntry = async (sourcePath: string, destinationPath: string, isDirectory: boolean): Promise<void> => {
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
        await copyEntry(src, dest, entry.isDirectory());
      }
    }
  } else {
    await fs.copyFile(sourcePath, destinationPath);
  }
};

const moveEntry = async (sourcePath: string, destinationPath: string, isDirectory: boolean): Promise<void> => {
  try {
    await fs.rename(sourcePath, destinationPath);
  } catch (error: any) {
    if (error.code === 'EXDEV') {
      await copyEntry(sourcePath, destinationPath, isDirectory);
      await fs.rm(sourcePath, { recursive: isDirectory, force: true });
    } else {
      throw error;
    }
  }
};

export interface TransferResultItem {
  from: string;
  to: string;
  skipped?: boolean;
}

export interface TransferResult {
  destination: string;
  items: TransferResultItem[];
}

const transferItems = async (
  items: PathItem[],
  destination: string,
  operation: TransferOperation,
): Promise<TransferResult> => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('At least one item is required.');
  }

  const destinationRelative = normalizeRelativePath(destination);

  // Prevent copying/moving items directly to the volume root
  if (!destinationRelative || destinationRelative.trim() === '') {
    throw new Error('Cannot copy or move items to the root volume path. Please select a specific volume first.');
  }

  const destinationAbsolute = resolveVolumePath(destinationRelative);
  await ensureDir(destinationAbsolute);

  const results: TransferResultItem[] = [];

  for (const item of items) {
    const { relativePath: sourceRelative, absolutePath: sourceAbsolute } = resolveItemPaths(item);
    if (!(await pathExists(sourceAbsolute))) {
      throw new Error(`Source path not found: ${sourceRelative}`);
    }

    const stats = await fs.stat(sourceAbsolute);
    const sourceParent = normalizeRelativePath(path.dirname(sourceRelative));

    if (operation === 'move' && destinationRelative === sourceParent) {
      results.push({ from: sourceRelative, to: sourceRelative, skipped: true });
      continue;
    }

    const desiredName = item.newName || item.name;
    const availableName = await findAvailableName(destinationAbsolute, desiredName);
    const targetAbsolute = path.join(destinationAbsolute, availableName);
    const targetRelative = combineRelativePath(destinationRelative, availableName);

    if (operation === 'copy') {
      await copyEntry(sourceAbsolute, targetAbsolute, stats.isDirectory());
    } else if (operation === 'move') {
      await moveEntry(sourceAbsolute, targetAbsolute, stats.isDirectory());
    } else {
      throw new Error(`Unsupported operation: ${operation}`);
    }

    results.push({ from: sourceRelative, to: targetRelative });
  }

  return { destination: destinationRelative, items: results };
};

export interface DeleteResultItem {
  path: string;
  status: 'missing' | 'deleted';
}

const deleteItems = async (items: PathItem[] = []): Promise<DeleteResultItem[]> => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('At least one item is required.');
  }

  const results: DeleteResultItem[] = [];

  for (const item of items) {
    const { relativePath, absolutePath } = resolveItemPaths(item);
    if (!(await pathExists(absolutePath))) {
      results.push({ path: relativePath, status: 'missing' });
      continue;
    }

    const stats = await fs.stat(absolutePath);
    await fs.rm(absolutePath, { recursive: stats.isDirectory(), force: true });
    results.push({ path: relativePath, status: 'deleted' });
  }

  return results;
};

export { transferItems, deleteItems };

module.exports = {
  transferItems,
  deleteItems,
};
