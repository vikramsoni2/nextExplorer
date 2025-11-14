/**
 * Error Handler Middleware
 * Centralized error handling for API
 */

const { BaseError } = require('../../../shared/errors');
const { sendError } = require('../../../shared/helpers/response.helper');
const { normalizeError, formatErrorForLog } = require('../../../shared/helpers/error.helper');
const logger = require('../../../shared/logger/logger');

/**
 * Error handler middleware
 */
function errorHandler(err, req, res, next) {
  // Normalize error to BaseError
  const error = normalizeError(err);

  // Log error
  if (error.statusCode >= 500) {
    logger.error({ error: formatErrorForLog(error), req: { method: req.method, url: req.url } }, 'Internal server error');
  } else if (error.statusCode >= 400) {
    logger.warn({ error: formatErrorForLog(error), req: { method: req.method, url: req.url } }, 'Client error');
  }

  // Send error response
  sendError(res, error);
}

/**
 * Not found handler (404)
 */
function notFoundHandler(req, res, next) {
  const { NotFoundError } = require('../../../shared/errors');
  next(new NotFoundError('Resource'));
}

module.exports = {
  errorHandler,
  notFoundHandler
};
