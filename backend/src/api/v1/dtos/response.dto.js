/**
 * Base Response DTOs
 * Standard response formats for API
 */

class BaseResponseDto {
  constructor(success = true) {
    this.success = success;
  }
}

class SuccessResponseDto extends BaseResponseDto {
  constructor(data, message = null) {
    super(true);
    this.data = data;
    if (message) {
      this.message = message;
    }
  }
}

class ErrorResponseDto extends BaseResponseDto {
  constructor(error) {
    super(false);
    this.error = {
      code: error.code || 'INTERNAL_ERROR',
      message: error.message || 'An error occurred',
      ...(error.details && { details: error.details }),
      ...(error.field && { field: error.field })
    };
  }
}

module.exports = {
  BaseResponseDto,
  SuccessResponseDto,
  ErrorResponseDto
};
