const BaseError = require('./base.error');

/**
 * Conflict Error
 * Thrown when there's a conflict with existing resource
 */
class ConflictError extends BaseError {
  constructor(message = 'Resource already exists', field = null) {
    super(message, 409, 'CONFLICT');
    this.field = field;
  }

  toJSON() {
    const json = super.toJSON();
    if (this.field) {
      json.error.field = this.field;
    }
    return json;
  }
}

/**
 * Duplicate Error
 * Thrown when attempting to create duplicate resource
 */
class DuplicateError extends BaseError {
  constructor(resource = 'Resource', field = null, value = null) {
    const message = field
      ? `${resource} with ${field} '${value}' already exists`
      : `${resource} already exists`;
    super(message, 409, 'DUPLICATE');
    this.resource = resource;
    this.field = field;
    this.value = value;
  }
}

module.exports = {
  ConflictError,
  DuplicateError
};
