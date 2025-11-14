/**
 * Search Validator
 * Validates search request payloads
 */

const { ValidationError } = require('../../../shared/errors');

class SearchValidator {
  /**
   * Validate content search request
   */
  static validateContentSearch(req, res, next) {
    const { query, maxResults } = req.body;

    // Query is required and must be a non-empty string
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return next(new ValidationError('Search query is required and must be a non-empty string'));
    }

    // Query must not be too long (prevent abuse)
    if (query.length > 500) {
      return next(new ValidationError('Search query must not exceed 500 characters'));
    }

    // Max results validation
    if (maxResults !== undefined) {
      if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 1000) {
        return next(new ValidationError('maxResults must be an integer between 1 and 1000'));
      }
    }

    // Path validation (if provided)
    if (req.body.path !== undefined && typeof req.body.path !== 'string') {
      return next(new ValidationError('path must be a string'));
    }

    next();
  }

  /**
   * Validate name search request
   */
  static validateNameSearch(req, res, next) {
    const { query, maxResults } = req.body;

    // Query is required and must be a non-empty string
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return next(new ValidationError('Search query is required and must be a non-empty string'));
    }

    // Query must not be too long
    if (query.length > 255) {
      return next(new ValidationError('Search query must not exceed 255 characters'));
    }

    // Max results validation
    if (maxResults !== undefined) {
      if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 1000) {
        return next(new ValidationError('maxResults must be an integer between 1 and 1000'));
      }
    }

    // Path validation (if provided)
    if (req.body.path !== undefined && typeof req.body.path !== 'string') {
      return next(new ValidationError('path must be a string'));
    }

    next();
  }
}

module.exports = SearchValidator;
