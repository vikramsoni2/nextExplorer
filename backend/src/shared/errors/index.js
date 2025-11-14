const BaseError = require('./base.error');
const {
  AuthenticationError,
  InvalidCredentialsError,
  AccountLockedError,
  SessionExpiredError,
  TokenInvalidError
} = require('./authentication.error');
const {
  AuthorizationError,
  ForbiddenError,
  InsufficientPermissionsError
} = require('./authorization.error');
const {
  ValidationError,
  BadRequestError,
  InvalidInputError
} = require('./validation.error');
const {
  NotFoundError,
  FileNotFoundError,
  UserNotFoundError,
  DirectoryNotFoundError
} = require('./not-found.error');
const {
  ConflictError,
  DuplicateError
} = require('./conflict.error');
const {
  InternalServerError,
  DatabaseError,
  ExternalServiceError,
  ConfigurationError
} = require('./internal.error');

module.exports = {
  // Base
  BaseError,

  // Authentication
  AuthenticationError,
  InvalidCredentialsError,
  AccountLockedError,
  SessionExpiredError,
  TokenInvalidError,

  // Authorization
  AuthorizationError,
  ForbiddenError,
  InsufficientPermissionsError,

  // Validation
  ValidationError,
  BadRequestError,
  InvalidInputError,

  // Not Found
  NotFoundError,
  FileNotFoundError,
  UserNotFoundError,
  DirectoryNotFoundError,

  // Conflict
  ConflictError,
  DuplicateError,

  // Internal
  InternalServerError,
  DatabaseError,
  ExternalServiceError,
  ConfigurationError
};
