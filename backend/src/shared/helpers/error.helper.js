const { BaseError, InternalServerError } = require('../errors');

/**
 * Check if error is operational (known/expected error)
 */
function isOperationalError(error) {
  if (error instanceof BaseError) {
    return error.isOperational;
  }
  return false;
}

/**
 * Wrap unknown errors into BaseError
 */
function normalizeError(error) {
  if (error instanceof BaseError) {
    return error;
  }

  // Handle specific error types
  if (error.name === 'ValidationError' && error.details) {
    const { ValidationError } = require('../errors');
    return new ValidationError(error.message, error.details);
  }

  if (error.code === 'ENOENT') {
    const { FileNotFoundError } = require('../errors');
    return new FileNotFoundError(error.path);
  }

  if (error.code === 'EACCES' || error.code === 'EPERM') {
    const { AuthorizationError } = require('../errors');
    return new AuthorizationError('Permission denied');
  }

  // Default to internal server error
  return new InternalServerError(error.message);
}

/**
 * Format error for logging
 */
function formatErrorForLog(error) {
  return {
    message: error.message,
    code: error.code,
    statusCode: error.statusCode,
    stack: error.stack,
    ...(error.details && { details: error.details }),
    ...(error.field && { field: error.field }),
    ...(error.resource && { resource: error.resource })
  };
}

module.exports = {
  isOperationalError,
  normalizeError,
  formatErrorForLog
};
