/**
 * Path Utility Functions
 * Safe path handling and validation
 */

const path = require('path');
const { pathExists } = require('./file-system.util');

const NAME_INVALID_PATTERN = /[\\/]/;
const RESERVED_NAMES = new Set(['.', '..']);

/**
 * Normalize relative path and prevent directory traversal
 * @param {string} relativePath - Relative path to normalize
 * @returns {string} - Normalized path
 * @throws {Error} - If path contains traversal attempts
 */
const normalizeRelativePath = (relativePath = '') => {
  if (!relativePath || relativePath === '/') {
    return '';
  }

  const normalized = path
    .normalize(relativePath.replace(/\\/g, '/'))
    .replace(/^[\\/]+/, '');

  if (normalized === '.') {
    return '';
  }

  if (normalized === '..' || normalized.startsWith('..' + path.sep)) {
    throw new Error('Invalid path. Traversal outside the volume root is not allowed.');
  }

  return normalized;
};

/**
 * Resolve relative path to absolute path within volume root
 * @param {string} relativePath - Relative path
 * @param {string} volumeRoot - Volume root directory
 * @returns {string} - Absolute path
 * @throws {Error} - If resolved path is outside volume root
 */
const resolveVolumePath = (relativePath = '', volumeRoot) => {
  const safeRelativePath = normalizeRelativePath(relativePath);
  const absolutePath = path.resolve(volumeRoot, safeRelativePath);
  const volumeWithSep = volumeRoot.endsWith(path.sep) ? volumeRoot : `${volumeRoot}${path.sep}`;

  if (absolutePath !== volumeRoot && !absolutePath.startsWith(volumeWithSep)) {
    throw new Error('Resolved path is outside the configured volume root.');
  }

  return absolutePath;
};

/**
 * Safely combine parent path and name
 * @param {string} parent - Parent path
 * @param {string} name - Name to append
 * @returns {string} - Combined path
 */
const combineRelativePath = (parent = '', name = '') => {
  const normalizedParent = normalizeRelativePath(parent);
  const combined = path.posix.join(normalizedParent, name);
  return normalizeRelativePath(combined);
};

/**
 * Split filename into base and extension
 * @param {string} name - Filename
 * @returns {{base: string, extension: string}} - Base and extension
 */
const splitName = (name) => {
  const extension = path.extname(name);
  const base = extension ? name.slice(0, -extension.length) : name;
  return { base, extension };
};

/**
 * Find available filename (adds counter if exists)
 * @param {string} directory - Directory to check
 * @param {string} desiredName - Desired filename
 * @returns {Promise<string>} - Available filename
 */
const findAvailableName = async (directory, desiredName) => {
  let candidate = desiredName;
  let counter = 1;

  while (await pathExists(path.join(directory, candidate))) {
    const { base, extension } = splitName(desiredName);
    candidate = `${base} (${counter})${extension}`;
    counter += 1;
  }

  return candidate;
};

/**
 * Find available folder name (adds counter if exists)
 * @param {string} directory - Directory to check
 * @param {string} baseName - Desired folder name
 * @returns {Promise<string>} - Available folder name
 */
const findAvailableFolderName = async (directory, baseName = 'Untitled Folder') => {
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

/**
 * Validate filename
 * @param {string} rawName - Name to validate
 * @returns {string} - Validated name
 * @throws {Error} - If name is invalid
 */
const ensureValidName = (rawName) => {
  if (typeof rawName !== 'string') {
    throw new Error('A valid name is required.');
  }

  const name = rawName.trim();
  if (!name) {
    throw new Error('Name cannot be empty.');
  }

  if (NAME_INVALID_PATTERN.test(name)) {
    throw new Error('Name cannot contain path separators.');
  }

  // NOTE: Original code rejected spaces, but this seems overly restrictive
  // Commenting out for now - can be re-enabled if needed
  // if (name.includes(' ')) {
  //   throw new Error('Name contains invalid characters.');
  // }

  if (RESERVED_NAMES.has(name)) {
    throw new Error('This name is not allowed.');
  }

  return name;
};

/**
 * Resolve item paths from item object
 * @param {Object} item - Item with name and path properties
 * @param {string} volumeRoot - Volume root directory
 * @returns {{relativePath: string, absolutePath: string}} - Paths
 */
const resolveItemPaths = (item = {}, volumeRoot) => {
  if (!item || typeof item.name !== 'string') {
    throw new Error('Each item must include a name.');
  }

  const parentPath = item.path || '';
  const relativePath = combineRelativePath(parentPath, item.name);
  const absolutePath = resolveVolumePath(relativePath, volumeRoot);

  return { relativePath, absolutePath };
};

/**
 * Get file extension from filename
 * @param {string} filename - Filename
 * @returns {string} - Extension (without dot) or empty string
 */
const getExtension = (filename) => {
  const ext = path.extname(filename);
  return ext ? ext.slice(1).toLowerCase() : '';
};

module.exports = {
  normalizeRelativePath,
  resolveVolumePath,
  combineRelativePath,
  splitName,
  findAvailableName,
  findAvailableFolderName,
  ensureValidName,
  resolveItemPaths,
  getExtension
};
