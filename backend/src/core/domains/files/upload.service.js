/**
 * Upload Service
 * Handles file uploads
 */

const multer = require('multer');
const path = require('path');
const config = require('../../../shared/config');
const logger = require('../../../shared/logger/logger');

class UploadService {
  constructor() {
    this.volumeRoot = config.directories.volume;
  }

  /**
   * Create multer upload middleware
   */
  createUploadMiddleware() {
    const storage = multer.diskStorage({
      destination: (req, file, cb) => {
        const uploadPath = req.body.path || '';
        const absolutePath = path.join(this.volumeRoot, uploadPath);
        cb(null, absolutePath);
      },
      filename: (req, file, cb) => {
        // Use original filename
        cb(null, file.originalname);
      }
    });

    return multer({
      storage,
      limits: {
        fileSize: 1024 * 1024 * 1024, // 1GB max file size
        files: 50 // Max 50 files at once
      }
    });
  }

  /**
   * Process uploaded files
   */
  processUploadedFiles(files, uploadPath) {
    if (!Array.isArray(files)) {
      files = [files];
    }

    const results = files.map(file => ({
      name: file.filename,
      path: uploadPath,
      size: file.size,
      mimetype: file.mimetype
    }));

    logger.info({ count: results.length, path: uploadPath }, 'Files uploaded');

    return results;
  }
}

module.exports = UploadService;
