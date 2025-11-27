/**
 * Base Application Error class
 * All custom errors should extend this class
 */
export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  timestamp: string;

  constructor(message: string, statusCode = 500) {
    super(message);

    this.statusCode = statusCode;
    this.isOperational = true; // Distinguishes operational errors from programmer errors
    this.timestamp = new Date().toISOString();

    // Capture stack trace, excluding constructor call from it
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): { message: string; statusCode: number; timestamp: string } {
    return {
      message: this.message,
      statusCode: this.statusCode,
      timestamp: this.timestamp,
    };
  }
}

/**
 * 400 Bad Request - for validation errors
 */
export class ValidationError extends AppError {
  details: unknown;

  constructor(message = 'Validation failed', details: unknown = null) {
    super(message, 400);
    this.name = 'ValidationError';
    this.details = details;
  }

  toJSON(): ReturnType<AppError['toJSON']> & { details: unknown } {
    return {
      ...super.toJSON(),
      details: this.details,
    };
  }
}

/**
 * 401 Unauthorized - for authentication errors
 */
export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401);
    this.name = 'UnauthorizedError';
  }
}

/**
 * 403 Forbidden - for authorization/permission errors
 */
export class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403);
    this.name = 'ForbiddenError';
  }
}

/**
 * 404 Not Found - for missing resources
 */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}

/**
 * 409 Conflict - for resource conflicts
 */
export class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409);
    this.name = 'ConflictError';
  }
}

/**
 * 429 Too Many Requests - for rate limiting
 */
export class RateLimitError extends AppError {
  retryAfter: string | number | null;

  constructor(message = 'Too many requests', retryAfter: string | number | null = null) {
    super(message, 429);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }

  toJSON(): ReturnType<AppError['toJSON']> & { retryAfter?: string | number | null } {
    const json = super.toJSON() as any;
    if (this.retryAfter) {
      json.retryAfter = this.retryAfter;
    }
    return json;
  }
}

/**
 * 500 Internal Server Error - for unexpected server errors
 */
export class InternalError extends AppError {
  constructor(message = 'Internal server error') {
    super(message, 500);
    this.name = 'InternalError';
  }
}

/**
 * 415 Unsupported Media Type - for unsupported file types
 */
export class UnsupportedMediaTypeError extends AppError {
  constructor(message = 'Unsupported media type') {
    super(message, 415);
    this.name = 'UnsupportedMediaTypeError';
  }
}

module.exports = {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  InternalError,
  UnsupportedMediaTypeError,
};
