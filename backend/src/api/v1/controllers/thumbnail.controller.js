/**
 * Thumbnail Controller
 * Thumbnail generation and serving endpoints
 */

const { sendSuccess } = require('../../../shared/helpers/response.helper');
const { ValidationError, FileNotFoundError } = require('../../../shared/errors');
const path = require('path');

class ThumbnailController {
  constructor({ thumbnailService, fileSystemService }) {
    this.thumbnailService = thumbnailService;
    this.fileSystemService = fileSystemService;
  }

  /**
   * GET /api/v1/thumbnails/*
   * Get or generate thumbnail for file
   */
  async getThumbnail(req, res, next) {
    try {
      const relativePath = req.params[0] || '';

      if (!relativePath) {
        throw new ValidationError('A file path is required');
      }

      // Check if file exists
      if (!(await this.fileSystemService.exists(relativePath))) {
        throw new FileNotFoundError(relativePath);
      }

      // Check if it's a file
      const stats = await this.fileSystemService.stat(relativePath);
      if (!stats.isFile()) {
        throw new ValidationError('Thumbnails are only available for files');
      }

      // Check file extension
      const ext = path.extname(relativePath).slice(1).toLowerCase();
      if (ext === 'pdf') {
        throw new ValidationError('Thumbnails are not available for PDF files');
      }

      // Check if file type is supported
      const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff'];
      const videoExts = ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg'];
      const supportedExts = [...imageExts, ...videoExts];

      if (!supportedExts.includes(ext)) {
        throw new ValidationError('Thumbnails are not available for this file type');
      }

      // Get or generate thumbnail
      const thumbnail = await this.thumbnailService.getThumbnail(relativePath);

      return sendSuccess(res, { thumbnail: thumbnail || '' });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = ThumbnailController;
