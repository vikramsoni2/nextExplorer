/**
 * File System Service
 * Core file system operations
 */

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { FileNotFoundError, ValidationError, ForbiddenError } = require('../../../shared/errors');
const { normalizeRelativePath, resolveVolumePath, ensureValidName } = require('../../../shared/utils/path.util');
const { pathExists } = require('../../../shared/utils/file-system.util');
const config = require('../../../shared/config');
const logger = require('../../../shared/logger/logger');

class FileSystemService {
  constructor() {
    this.volumeRoot = config.directories.volume;
  }

  /**
   * Resolve relative path to absolute path
   */
  resolvePath(relativePath) {
    return resolveVolumePath(relativePath, this.volumeRoot);
  }

  /**
   * Check if path exists
   */
  async exists(relativePath) {
    const absolutePath = this.resolvePath(relativePath);
    return pathExists(absolutePath);
  }

  /**
   * Get file/directory stats
   */
  async stat(relativePath) {
    const absolutePath = this.resolvePath(relativePath);

    try {
      return await fs.stat(absolutePath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new FileNotFoundError(relativePath);
      }
      throw error;
    }
  }

  /**
   * Read directory contents
   */
  async readDirectory(relativePath) {
    const absolutePath = this.resolvePath(relativePath);

    try {
      const entries = await fs.readdir(absolutePath, { withFileTypes: true });
      return entries;
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new FileNotFoundError(relativePath);
      }
      if (error.code === 'EACCES' || error.code === 'EPERM') {
        throw new ForbiddenError('Permission denied');
      }
      throw error;
    }
  }

  /**
   * Create directory
   */
  async createDirectory(relativePath, name) {
    ensureValidName(name);

    const parentPath = this.resolvePath(relativePath);
    const newDirPath = path.join(parentPath, name);

    // Check if already exists
    if (await pathExists(newDirPath)) {
      throw new ValidationError(`Directory "${name}" already exists`);
    }

    try {
      await fs.mkdir(newDirPath, { recursive: false });
      logger.info({ path: path.join(relativePath, name) }, 'Directory created');
    } catch (error) {
      if (error.code === 'EEXIST') {
        throw new ValidationError(`Directory "${name}" already exists`);
      }
      throw error;
    }

    return path.join(relativePath, name);
  }

  /**
   * Rename file or directory
   */
  async rename(relativePath, newName) {
    ensureValidName(newName);

    const oldAbsolutePath = this.resolvePath(relativePath);
    const parentDir = path.dirname(oldAbsolutePath);
    const newAbsolutePath = path.join(parentDir, newName);

    // Check if source exists
    if (!(await pathExists(oldAbsolutePath))) {
      throw new FileNotFoundError(relativePath);
    }

    // Check if target already exists
    if (await pathExists(newAbsolutePath)) {
      throw new ValidationError(`"${newName}" already exists`);
    }

    try {
      await fs.rename(oldAbsolutePath, newAbsolutePath);
      logger.info({ from: relativePath, to: newName }, 'Renamed');
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new FileNotFoundError(relativePath);
      }
      throw error;
    }

    const parentRelative = normalizeRelativePath(path.dirname(relativePath));
    return path.join(parentRelative, newName);
  }

  /**
   * Delete file or directory
   */
  async delete(relativePath) {
    const absolutePath = this.resolvePath(relativePath);

    // Check if exists
    if (!(await pathExists(absolutePath))) {
      throw new FileNotFoundError(relativePath);
    }

    try {
      const stats = await fs.stat(absolutePath);

      if (stats.isDirectory()) {
        await fs.rm(absolutePath, { recursive: true, force: true });
      } else {
        await fs.unlink(absolutePath);
      }

      logger.info({ path: relativePath }, 'Deleted');
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new FileNotFoundError(relativePath);
      }
      throw error;
    }
  }

  /**
   * Copy file or directory
   */
  async copy(srcRelativePath, destRelativePath) {
    const srcAbsolutePath = this.resolvePath(srcRelativePath);
    const destAbsolutePath = this.resolvePath(destRelativePath);

    // Check if source exists
    if (!(await pathExists(srcAbsolutePath))) {
      throw new FileNotFoundError(srcRelativePath);
    }

    // Check if destination already exists
    if (await pathExists(destAbsolutePath)) {
      throw new ValidationError(`Destination already exists`);
    }

    try {
      const stats = await fs.stat(srcAbsolutePath);

      if (stats.isDirectory()) {
        await fs.cp(srcAbsolutePath, destAbsolutePath, { recursive: true });
      } else {
        await fs.copyFile(srcAbsolutePath, destAbsolutePath);
      }

      logger.info({ from: srcRelativePath, to: destRelativePath }, 'Copied');
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new FileNotFoundError(srcRelativePath);
      }
      throw error;
    }
  }

  /**
   * Move file or directory
   */
  async move(srcRelativePath, destRelativePath) {
    const srcAbsolutePath = this.resolvePath(srcRelativePath);
    const destAbsolutePath = this.resolvePath(destRelativePath);

    // Check if source exists
    if (!(await pathExists(srcAbsolutePath))) {
      throw new FileNotFoundError(srcRelativePath);
    }

    // Check if destination already exists
    if (await pathExists(destAbsolutePath)) {
      throw new ValidationError(`Destination already exists`);
    }

    try {
      await fs.rename(srcAbsolutePath, destAbsolutePath);
      logger.info({ from: srcRelativePath, to: destRelativePath }, 'Moved');
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new FileNotFoundError(srcRelativePath);
      }
      // If rename fails (cross-device), try copy + delete
      if (error.code === 'EXDEV') {
        await this.copy(srcRelativePath, destRelativePath);
        await this.delete(srcRelativePath);
      } else {
        throw error;
      }
    }
  }

  /**
   * Read file content
   */
  async readFile(relativePath, encoding = 'utf8') {
    const absolutePath = this.resolvePath(relativePath);

    try {
      return await fs.readFile(absolutePath, encoding);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new FileNotFoundError(relativePath);
      }
      throw error;
    }
  }

  /**
   * Write file content
   */
  async writeFile(relativePath, content, encoding = 'utf8') {
    const absolutePath = this.resolvePath(relativePath);

    try {
      await fs.writeFile(absolutePath, content, encoding);
      logger.info({ path: relativePath }, 'File written');
    } catch (error) {
      throw error;
    }
  }

  /**
   * Create read stream
   */
  createReadStream(relativePath, options = {}) {
    const absolutePath = this.resolvePath(relativePath);
    return fsSync.createReadStream(absolutePath, options);
  }

  /**
   * Create write stream
   */
  createWriteStream(relativePath, options = {}) {
    const absolutePath = this.resolvePath(relativePath);
    return fsSync.createWriteStream(absolutePath, options);
  }
}

module.exports = FileSystemService;
