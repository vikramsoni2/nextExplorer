import path from 'path';
import * as fsp from 'fs/promises';

import { ensureDir, pathExists } from '../utils/fsUtils';
import {
  combineRelativePath,
  findAvailableName,
  normalizeRelativePath,
  resolveItemPaths,
  resolveVolumePath,
  type ItemDescriptor,
} from '../utils/pathUtils';

const { copyFile, readdir, rename, rm, stat } = fsp;

const copyEntry = async (sourcePath: string, destinationPath: string, isDirectory: boolean): Promise<void> => {
  if (isDirectory) {
    if (typeof fsp.cp === 'function') {
      await fsp.cp(sourcePath, destinationPath, {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
    } else {
      await ensureDir(destinationPath);
      const entries = await readdir(sourcePath, { withFileTypes: true });
      for (const entry of entries) {
        const src = path.join(sourcePath, entry.name);
        const dest = path.join(destinationPath, entry.name);
        // eslint-disable-next-line no-await-in-loop
        await copyEntry(src, dest, entry.isDirectory());
      }
    }
  } else {
    await copyFile(sourcePath, destinationPath);
  }
};

const moveEntry = async (sourcePath: string, destinationPath: string, isDirectory: boolean): Promise<void> => {
  try {
    await rename(sourcePath, destinationPath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'EXDEV') {
      await copyEntry(sourcePath, destinationPath, isDirectory);
      await rm(sourcePath, { recursive: isDirectory, force: true });
    } else {
      throw error;
    }
  }
};

export type TransferOperation = 'copy' | 'move';

export interface TransferItemInput extends ItemDescriptor {
  newName?: string;
}

export interface TransferResultItem {
  from: string;
  to: string;
  skipped?: boolean;
}

export interface TransferResult {
  destination: string;
  items: TransferResultItem[];
}

export interface DeleteResultItem {
  path: string;
  status: 'missing' | 'deleted';
}

export const transferItems = async (
  items: TransferItemInput[],
  destination: string,
  operation: TransferOperation,
): Promise<TransferResult> => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('At least one item is required.');
  }

  const destinationRelative = normalizeRelativePath(destination);
  const destinationAbsolute = resolveVolumePath(destinationRelative);
  await ensureDir(destinationAbsolute);

  const results: TransferResultItem[] = [];

  for (const item of items) {
    const { relativePath: sourceRelative, absolutePath: sourceAbsolute } = resolveItemPaths(item);
    if (!(await pathExists(sourceAbsolute))) {
      throw new Error(`Source path not found: ${sourceRelative}`);
    }

    const stats = await stat(sourceAbsolute);
    const sourceParent = normalizeRelativePath(path.posix.dirname(sourceRelative));

    if (operation === 'move' && destinationRelative === sourceParent) {
      results.push({ from: sourceRelative, to: sourceRelative, skipped: true });
      continue;
    }

    const desiredName = typeof item.newName === 'string' && item.newName.trim()
      ? item.newName
      : item.name;
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

export const deleteItems = async (items: ItemDescriptor[] = []): Promise<DeleteResultItem[]> => {
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

    const stats = await stat(absolutePath);
    await rm(absolutePath, { recursive: stats.isDirectory(), force: true });
    results.push({ path: relativePath, status: 'deleted' });
  }

  return results;
};
