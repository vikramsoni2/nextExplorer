const BaseError = require('./base.error');

/**
 * Validation Error
 * Thrown when input validation fails
 */
class ValidationError extends BaseError {
  constructor(message = 'Validation failed', details = []) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        statusCode: this.statusCode,
        details: this.details
      }
    };
  }
}

/**
 * Bad Request Error
 * Thrown when request is malformed
 */
class BadRequestError extends BaseError {
  constructor(message = 'Bad request') {
    super(message, 400, 'BAD_REQUEST');
  }
}

/**
 * Invalid Input Error
 * Thrown when specific input field is invalid
 */
class InvalidInputError extends BaseError {
  constructor(field, message = 'Invalid input') {
    super(message, 400, 'INVALID_INPUT');
    this.field = field;
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        statusCode: this.statusCode,
        field: this.field
      }
    };
  }
}

module.exports = {
  ValidationError,
  BadRequestError,
  InvalidInputError
};
