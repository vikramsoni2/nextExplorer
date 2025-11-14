/**
 * Search Controller
 * Search endpoints for content and filename search
 */

const { sendSuccess } = require('../../../shared/helpers/response.helper');

class SearchController {
  constructor({ searchService }) {
    this.searchService = searchService;
  }

  /**
   * POST /api/v1/search/content
   * Search for content in files
   */
  async searchContent(req, res, next) {
    try {
      const { query, path, caseSensitive, regexp, maxResults } = req.body;

      const result = await this.searchService.searchContent(query, {
        path,
        caseSensitive: caseSensitive === true,
        regexp: regexp === true,
        maxResults: maxResults || 100
      });

      return sendSuccess(res, result, `Found ${result.count} match(es)`);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/search/name
   * Search by filename
   */
  async searchByName(req, res, next) {
    try {
      const { query, path, caseSensitive, maxResults } = req.body;

      const result = await this.searchService.searchByName(query, {
        path,
        caseSensitive: caseSensitive === true,
        maxResults: maxResults || 100
      });

      return sendSuccess(res, result, `Found ${result.count} item(s)`);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = SearchController;
