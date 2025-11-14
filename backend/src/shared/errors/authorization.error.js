const BaseError = require('./base.error');

/**
 * Authorization Error
 * Thrown when user doesn't have permission to access resource
 */
class AuthorizationError extends BaseError {
  constructor(message = 'Access denied', resource = null) {
    super(message, 403, 'AUTHORIZATION_ERROR');
    this.resource = resource;
  }

  toJSON() {
    const json = super.toJSON();
    if (this.resource) {
      json.error.resource = this.resource;
    }
    return json;
  }
}

/**
 * Forbidden Error
 * Thrown when action is forbidden
 */
class ForbiddenError extends BaseError {
  constructor(message = 'This action is forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

/**
 * Insufficient Permissions Error
 * Thrown when user lacks required permissions
 */
class InsufficientPermissionsError extends BaseError {
  constructor(requiredPermission = null) {
    const message = requiredPermission
      ? `Insufficient permissions. Required: ${requiredPermission}`
      : 'Insufficient permissions';
    super(message, 403, 'INSUFFICIENT_PERMISSIONS');
    this.requiredPermission = requiredPermission;
  }
}

module.exports = {
  AuthorizationError,
  ForbiddenError,
  InsufficientPermissionsError
};
