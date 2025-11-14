/**
 * File System Adapter
 * Abstracts file system operations for easier testing and swapping
 */

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const config = require('../../shared/config');
const { resolveVolumePath } = require('../../shared/utils/path.util');

class FileSystemAdapter {
  constructor(volumeRoot = null) {
    this.volumeRoot = volumeRoot || config.directories.volume;
  }

  /**
   * Resolve path within volume
   * @param {string} relativePath - Relative path
   * @returns {string} - Absolute path
   */
  resolvePath(relativePath) {
    return resolveVolumePath(relativePath, this.volumeRoot);
  }

  /**
   * Read file
   * @param {string} relativePath - Relative path
   * @param {string} encoding - Encoding (default: 'utf8')
   * @returns {Promise<string|Buffer>} - File contents
   */
  async readFile(relativePath, encoding = 'utf8') {
    const absolutePath = this.resolvePath(relativePath);
    return fs.readFile(absolutePath, encoding);
  }

  /**
   * Write file
   * @param {string} relativePath - Relative path
   * @param {string|Buffer} data - Data to write
   * @param {string} encoding - Encoding (default: 'utf8')
   */
  async writeFile(relativePath, data, encoding = 'utf8') {
    const absolutePath = this.resolvePath(relativePath);
    return fs.writeFile(absolutePath, data, encoding);
  }

  /**
   * Check if file/directory exists
   * @param {string} relativePath - Relative path
   * @returns {Promise<boolean>} - True if exists
   */
  async exists(relativePath) {
    try {
      const absolutePath = this.resolvePath(relativePath);
      await fs.access(absolutePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get file stats
   * @param {string} relativePath - Relative path
   * @returns {Promise<Object>} - File stats
   */
  async stat(relativePath) {
    const absolutePath = this.resolvePath(relativePath);
    return fs.stat(absolutePath);
  }

  /**
   * Read directory
   * @param {string} relativePath - Relative path
   * @returns {Promise<Array>} - Directory entries
   */
  async readdir(relativePath) {
    const absolutePath = this.resolvePath(relativePath);
    return fs.readdir(absolutePath);
  }

  /**
   * Read directory with file types
   * @param {string} relativePath - Relative path
   * @returns {Promise<Array>} - Directory entries with types
   */
  async readdirWithTypes(relativePath) {
    const absolutePath = this.resolvePath(relativePath);
    return fs.readdir(absolutePath, { withFileTypes: true });
  }

  /**
   * Create directory
   * @param {string} relativePath - Relative path
   * @param {boolean} recursive - Create parent directories
   */
  async mkdir(relativePath, recursive = true) {
    const absolutePath = this.resolvePath(relativePath);
    return fs.mkdir(absolutePath, { recursive });
  }

  /**
   * Delete file
   * @param {string} relativePath - Relative path
   */
  async unlink(relativePath) {
    const absolutePath = this.resolvePath(relativePath);
    return fs.unlink(absolutePath);
  }

  /**
   * Delete directory
   * @param {string} relativePath - Relative path
   * @param {boolean} recursive - Delete recursively
   */
  async rmdir(relativePath, recursive = false) {
    const absolutePath = this.resolvePath(relativePath);
    return fs.rm(absolutePath, { recursive, force: recursive });
  }

  /**
   * Rename/move file or directory
   * @param {string} oldRelativePath - Old path
   * @param {string} newRelativePath - New path
   */
  async rename(oldRelativePath, newRelativePath) {
    const oldAbsolutePath = this.resolvePath(oldRelativePath);
    const newAbsolutePath = this.resolvePath(newRelativePath);
    return fs.rename(oldAbsolutePath, newAbsolutePath);
  }

  /**
   * Copy file
   * @param {string} srcRelativePath - Source path
   * @param {string} destRelativePath - Destination path
   */
  async copyFile(srcRelativePath, destRelativePath) {
    const srcAbsolutePath = this.resolvePath(srcRelativePath);
    const destAbsolutePath = this.resolvePath(destRelativePath);
    return fs.copyFile(srcAbsolutePath, destAbsolutePath);
  }

  /**
   * Create read stream
   * @param {string} relativePath - Relative path
   * @param {Object} options - Stream options
   * @returns {ReadStream} - Read stream
   */
  createReadStream(relativePath, options = {}) {
    const absolutePath = this.resolvePath(relativePath);
    return fsSync.createReadStream(absolutePath, options);
  }

  /**
   * Create write stream
   * @param {string} relativePath - Relative path
   * @param {Object} options - Stream options
   * @returns {WriteStream} - Write stream
   */
  createWriteStream(relativePath, options = {}) {
    const absolutePath = this.resolvePath(relativePath);
    return fsSync.createWriteStream(absolutePath, options);
  }
}

module.exports = FileSystemAdapter;
