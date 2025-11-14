/**
 * Browse Validator
 * Validates browse request parameters
 */

const { ValidationError } = require('../../../shared/errors');

class BrowseValidator {
  /**
   * Validate browse request
   */
  static validateBrowse(req, res, next) {
    // Path is optional, defaults to empty string
    // No specific validation needed for browse endpoint
    next();
  }
}

module.exports = BrowseValidator;
