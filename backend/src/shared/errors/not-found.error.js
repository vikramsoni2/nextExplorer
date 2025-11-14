const BaseError = require('./base.error');

/**
 * Not Found Error
 * Thrown when requested resource is not found
 */
class NotFoundError extends BaseError {
  constructor(resource = 'Resource', identifier = null) {
    const message = identifier
      ? `${resource} with identifier '${identifier}' not found`
      : `${resource} not found`;
    super(message, 404, 'NOT_FOUND');
    this.resource = resource;
    this.identifier = identifier;
  }

  toJSON() {
    const json = super.toJSON();
    if (this.resource) {
      json.error.resource = this.resource;
    }
    if (this.identifier) {
      json.error.identifier = this.identifier;
    }
    return json;
  }
}

/**
 * File Not Found Error
 * Thrown when file is not found
 */
class FileNotFoundError extends NotFoundError {
  constructor(filePath) {
    super('File', filePath);
    this.code = 'FILE_NOT_FOUND';
  }
}

/**
 * User Not Found Error
 * Thrown when user is not found
 */
class UserNotFoundError extends NotFoundError {
  constructor(identifier) {
    super('User', identifier);
    this.code = 'USER_NOT_FOUND';
  }
}

/**
 * Directory Not Found Error
 * Thrown when directory is not found
 */
class DirectoryNotFoundError extends NotFoundError {
  constructor(dirPath) {
    super('Directory', dirPath);
    this.code = 'DIRECTORY_NOT_FOUND';
  }
}

module.exports = {
  NotFoundError,
  FileNotFoundError,
  UserNotFoundError,
  DirectoryNotFoundError
};
