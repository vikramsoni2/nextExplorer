/**
 * Download Controller
 * File download endpoints
 */

const path = require('path');
const { getMimeType } = require('../../../shared/constants');
const logger = require('../../../shared/logger/logger');

class DownloadController {
  constructor({ downloadService }) {
    this.downloadService = downloadService;
  }

  /**
   * GET /api/v1/files/download/*
   * Download single file
   */
  async downloadSingle(req, res, next) {
    try {
      const relativePath = req.params[0] || '';

      const { stream, filename, size } = await this.downloadService.downloadSingleFile(relativePath);

      const ext = path.extname(filename).slice(1);
      const mimeType = getMimeType(ext);

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Length', size);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

      stream.pipe(res);

      stream.on('error', (error) => {
        logger.error({ error, path: relativePath }, 'Download stream error');
        if (!res.headersSent) {
          next(error);
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/files/download
   * Download multiple files as ZIP
   */
  async downloadMultiple(req, res, next) {
    try {
      const { items } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          success: false,
          error: { message: 'Items array is required' }
        });
      }

      const archiveName = `download-${Date.now()}.zip`;
      const { stream, filename } = await this.downloadService.downloadMultipleFiles(items, archiveName);

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      stream.pipe(res);

      stream.on('error', (error) => {
        logger.error({ error }, 'Archive stream error');
        if (!res.headersSent) {
          next(error);
        }
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = DownloadController;
