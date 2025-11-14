const BaseError = require('./base.error');

/**
 * Authentication Error
 * Thrown when authentication fails
 */
class AuthenticationError extends BaseError {
  constructor(message = 'Authentication failed') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

/**
 * Invalid Credentials Error
 * Thrown when login credentials are incorrect
 */
class InvalidCredentialsError extends BaseError {
  constructor(message = 'Invalid email or password') {
    super(message, 401, 'INVALID_CREDENTIALS');
  }
}

/**
 * Account Locked Error
 * Thrown when account is locked due to failed login attempts
 */
class AccountLockedError extends BaseError {
  constructor(lockedUntil) {
    const message = lockedUntil
      ? `Account is locked until ${new Date(lockedUntil).toISOString()}`
      : 'Account is locked';
    super(message, 423, 'ACCOUNT_LOCKED');
    this.lockedUntil = lockedUntil;
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        statusCode: this.statusCode,
        lockedUntil: this.lockedUntil
      }
    };
  }
}

/**
 * Session Expired Error
 * Thrown when user session has expired
 */
class SessionExpiredError extends BaseError {
  constructor(message = 'Session has expired') {
    super(message, 401, 'SESSION_EXPIRED');
  }
}

/**
 * Token Invalid Error
 * Thrown when JWT or other token is invalid
 */
class TokenInvalidError extends BaseError {
  constructor(message = 'Invalid or expired token') {
    super(message, 401, 'TOKEN_INVALID');
  }
}

module.exports = {
  AuthenticationError,
  InvalidCredentialsError,
  AccountLockedError,
  SessionExpiredError,
  TokenInvalidError
};
