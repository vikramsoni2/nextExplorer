/**
 * Download Service
 * Handles file downloads (single and bulk ZIP)
 */

const archiver = require('archiver');
const path = require('path');
const { FileNotFoundError } = require('../../../shared/errors');
const { combineRelativePath } = require('../../../shared/utils/path.util');
const logger = require('../../../shared/logger/logger');

class DownloadService {
  constructor({ fileSystemService }) {
    this.fileSystemService = fileSystemService;
  }

  /**
   * Download single file
   * Returns stream
   */
  async downloadSingleFile(relativePath) {
    // Check if file exists
    if (!(await this.fileSystemService.exists(relativePath))) {
      throw new FileNotFoundError(relativePath);
    }

    // Check if it's a file (not directory)
    const stats = await this.fileSystemService.stat(relativePath);
    if (stats.isDirectory()) {
      throw new ValidationError('Cannot download directory as single file. Use bulk download instead.');
    }

    const stream = this.fileSystemService.createReadStream(relativePath);
    const filename = path.basename(relativePath);

    return {
      stream,
      filename,
      size: stats.size
    };
  }

  /**
   * Download multiple files as ZIP
   * Returns archive stream
   */
  async downloadMultipleFiles(items, archiveName = 'download.zip') {
    const archive = archiver('zip', {
      zlib: { level: 6 } // Compression level
    });

    let fileCount = 0;

    for (const item of items) {
      try {
        const { path: itemPath, name } = item;
        const fullPath = combineRelativePath(itemPath || '', name);
        const absolutePath = this.fileSystemService.resolvePath(fullPath);

        const stats = await this.fileSystemService.stat(fullPath);

        if (stats.isDirectory()) {
          // Add directory recursively
          archive.directory(absolutePath, name);
        } else {
          // Add file
          archive.file(absolutePath, { name });
        }

        fileCount++;
      } catch (error) {
        logger.warn({ item, error: error.message }, 'Failed to add item to archive');
      }
    }

    if (fileCount === 0) {
      throw new ValidationError('No valid files to download');
    }

    // Finalize archive
    archive.finalize();

    logger.info({ fileCount, archiveName }, 'Creating download archive');

    return {
      stream: archive,
      filename: archiveName
    };
  }
}

module.exports = DownloadService;
