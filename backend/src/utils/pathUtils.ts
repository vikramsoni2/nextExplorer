import path from 'path';

import { directories } from '../config';
import { pathExists } from './fsUtils';

const NAME_INVALID_PATTERN = /[\\/]/;
const RESERVED_NAMES = new Set(['.', '..']);

export const normalizeRelativePath = (relativePath = ''): string => {
  if (!relativePath || relativePath === '/') {
    return '';
  }

  const normalized = path
    .normalize(relativePath.replace(/\\/g, '/'))
    .replace(/^[\\/]+/, '');

  if (normalized === '.') {
    return '';
  }

  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error('Invalid path. Traversal outside the volume root is not allowed.');
  }

  return normalized;
};

export const resolveVolumePath = (relativePath = ''): string => {
  const safeRelativePath = normalizeRelativePath(relativePath);
  const absolutePath = path.resolve(directories.volume, safeRelativePath);

  if (absolutePath !== directories.volume && !absolutePath.startsWith(directories.volumeWithSep)) {
    throw new Error('Resolved path is outside the configured volume root.');
  }

  return absolutePath;
};

export const combineRelativePath = (parent = '', name = ''): string => {
  const normalizedParent = normalizeRelativePath(parent);
  const combined = path.posix.join(normalizedParent, name);
  return normalizeRelativePath(combined);
};

export const splitName = (name: string): { base: string; extension: string } => {
  const extension = path.extname(name);
  const base = extension ? name.slice(0, -extension.length) : name;
  return { base, extension };
};

export const findAvailableName = async (directory: string, desiredName: string): Promise<string> => {
  let candidate = desiredName;
  let counter = 1;

  while (await pathExists(path.join(directory, candidate))) {
    const { base, extension } = splitName(desiredName);
    candidate = `${base} (${counter})${extension}`;
    counter += 1;
  }

  return candidate;
};

export const findAvailableFolderName = async (directory: string, baseName = 'Untitled Folder'): Promise<string> => {
  if (!(await pathExists(path.join(directory, baseName)))) {
    return baseName;
  }

  let counter = 2;
  let candidate = `${baseName} ${counter}`;

  while (await pathExists(path.join(directory, candidate))) {
    counter += 1;
    candidate = `${baseName} ${counter}`;
  }

  return candidate;
};

export const ensureValidName = (rawName: string): string => {
  if (typeof rawName !== 'string') {
    throw new Error('A valid name is required.');
  }

  const name = rawName;
  if (!name.trim()) {
    throw new Error('Name cannot be empty.');
  }

  if (NAME_INVALID_PATTERN.test(name)) {
    throw new Error('Name cannot contain path separators.');
  }

  if (name.includes('\u0000')) {
    throw new Error('Name contains invalid characters.');
  }

  if (RESERVED_NAMES.has(name)) {
    throw new Error('This name is not allowed.');
  }

  return name;
};

export interface ItemDescriptor {
  path?: string;
  name: string;
}

export interface ResolvedItemPaths {
  relativePath: string;
  absolutePath: string;
}

export const resolveItemPaths = (item: ItemDescriptor): ResolvedItemPaths => {
  if (!item || typeof item.name !== 'string') {
    throw new Error('Each item must include a name.');
  }

  const parentPath = item.path || '';
  const relativePath = combineRelativePath(parentPath, item.name);
  const absolutePath = resolveVolumePath(relativePath);

  return { relativePath, absolutePath };
};
