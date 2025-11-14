/**
 * Metadata Controller
 * Metadata extraction endpoints
 */

const { sendSuccess } = require('../../../shared/helpers/response.helper');

class MetadataController {
  constructor({ metadataService }) {
    this.metadataService = metadataService;
  }

  /**
   * GET /api/v1/metadata/*
   * Extract metadata from file
   */
  async getMetadata(req, res, next) {
    try {
      const relativePath = req.params[0] || '';

      const metadata = await this.metadataService.extractMetadata(relativePath);

      return sendSuccess(res, metadata);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = MetadataController;
