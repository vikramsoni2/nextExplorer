/**
 * Browse Service
 * Directory listing and file browsing
 */

const path = require('path');
const { getExtension } = require('../../../shared/utils/path.util');
const { EXCLUDED_FILES } = require('../../../shared/constants');
const logger = require('../../../shared/logger/logger');

class BrowseService {
  constructor({ fileSystemService }) {
    this.fileSystemService = fileSystemService;
  }

  /**
   * List directory contents
   * @param {string} relativePath - Relative path to directory
   * @returns {Promise<Array>} - Array of file/directory metadata
   */
  async listDirectory(relativePath = '') {
    const entries = await this.fileSystemService.readDirectory(relativePath);

    const items = [];

    for (const entry of entries) {
      // Skip excluded files
      if (EXCLUDED_FILES.includes(entry.name.toLowerCase())) {
        continue;
      }

      // Skip hidden files (starting with .)
      if (entry.name.startsWith('.')) {
        continue;
      }

      try {
        const itemPath = path.join(relativePath, entry.name);
        const stats = await this.fileSystemService.stat(itemPath);

        const item = {
          name: entry.name,
          path: relativePath,
          isDirectory: stats.isDirectory(),
          size: stats.size,
          dateModified: stats.mtime.toISOString(),
          kind: stats.isDirectory() ? 'folder' : getExtension(entry.name) || 'file'
        };

        items.push(item);
      } catch (error) {
        // Skip items that can't be accessed
        logger.warn({ entry: entry.name, error: error.message }, 'Cannot access item');
      }
    }

    // Sort: directories first, then by name
    items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

    return items;
  }

  /**
   * Get item metadata
   * @param {string} relativePath - Relative path to item
   * @returns {Promise<Object>} - Item metadata
   */
  async getItemMetadata(relativePath) {
    const stats = await this.fileSystemService.stat(relativePath);
    const name = path.basename(relativePath);
    const parentPath = path.dirname(relativePath);

    return {
      name,
      path: parentPath === '.' ? '' : parentPath,
      isDirectory: stats.isDirectory(),
      size: stats.size,
      dateModified: stats.mtime.toISOString(),
      dateCreated: stats.birthtime.toISOString(),
      kind: stats.isDirectory() ? 'folder' : getExtension(name) || 'file'
    };
  }

  /**
   * Check if path is directory
   */
  async isDirectory(relativePath) {
    const stats = await this.fileSystemService.stat(relativePath);
    return stats.isDirectory();
  }

  /**
   * Check if path is file
   */
  async isFile(relativePath) {
    const stats = await this.fileSystemService.stat(relativePath);
    return stats.isFile();
  }
}

module.exports = BrowseService;
