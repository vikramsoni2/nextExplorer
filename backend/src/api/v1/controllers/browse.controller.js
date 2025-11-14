/**
 * Browse Controller
 * Directory browsing endpoints
 */

const { sendSuccess } = require('../../../shared/helpers/response.helper');
const { FileDto } = require('../dtos');

class BrowseController {
  constructor({ browseService }) {
    this.browseService = browseService;
  }

  /**
   * GET /api/v1/browse/*
   * List directory contents
   */
  async listDirectory(req, res, next) {
    try {
      // Path comes from wildcard route
      const relativePath = req.params[0] || '';

      const items = await this.browseService.listDirectory(relativePath);

      return sendSuccess(res, FileDto.toList(items));
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/metadata/*
   * Get item metadata
   */
  async getMetadata(req, res, next) {
    try {
      const relativePath = req.params[0] || '';

      const metadata = await this.browseService.getItemMetadata(relativePath);

      return sendSuccess(res, FileDto.toMetadata(metadata));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = BrowseController;
