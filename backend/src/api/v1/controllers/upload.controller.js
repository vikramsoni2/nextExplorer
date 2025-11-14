/**
 * Upload Controller
 * File upload endpoints
 */

const { sendSuccess } = require('../../../shared/helpers/response.helper');
const logger = require('../../../shared/logger/logger');

class UploadController {
  constructor({ uploadService }) {
    this.uploadService = uploadService;
  }

  /**
   * POST /api/v1/upload
   * Upload files
   */
  async upload(req, res, next) {
    try {
      const uploadPath = req.body.path || '';
      const files = req.files || [];

      const results = this.uploadService.processUploadedFiles(files, uploadPath);

      return sendSuccess(res, {
        files: results,
        count: results.length
      }, `Uploaded ${results.length} file(s)`);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = UploadController;
