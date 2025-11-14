const BaseError = require('./base.error');

/**
 * Internal Server Error
 * Thrown when an unexpected error occurs
 */
class InternalServerError extends BaseError {
  constructor(message = 'An internal server error occurred') {
    super(message, 500, 'INTERNAL_SERVER_ERROR');
  }
}

/**
 * Database Error
 * Thrown when database operation fails
 */
class DatabaseError extends BaseError {
  constructor(message = 'Database operation failed', originalError = null) {
    super(message, 500, 'DATABASE_ERROR');
    this.originalError = originalError;
  }
}

/**
 * External Service Error
 * Thrown when external service call fails
 */
class ExternalServiceError extends BaseError {
  constructor(service = 'External service', message = 'Service unavailable') {
    super(`${service}: ${message}`, 503, 'EXTERNAL_SERVICE_ERROR');
    this.service = service;
  }
}

/**
 * Configuration Error
 * Thrown when configuration is invalid or missing
 */
class ConfigurationError extends BaseError {
  constructor(message = 'Configuration error', isOperational = false) {
    super(message, 500, 'CONFIGURATION_ERROR', isOperational);
  }
}

module.exports = {
  InternalServerError,
  DatabaseError,
  ExternalServiceError,
  ConfigurationError
};
