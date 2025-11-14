/**
 * Files Validators
 * Request validation for file operations
 */

const { ValidationError } = require('../../../shared/errors');

/**
 * Validate create folder request
 */
function validateCreateFolder(req, res, next) {
  const { name } = req.body;

  const errors = [];

  if (!name) {
    errors.push('Folder name is required');
  } else if (typeof name !== 'string') {
    errors.push('Folder name must be a string');
  } else if (name.trim().length === 0) {
    errors.push('Folder name cannot be empty');
  }

  if (errors.length > 0) {
    return next(new ValidationError('Validation failed', errors));
  }

  next();
}

/**
 * Validate rename request
 */
function validateRename(req, res, next) {
  const { name, newName } = req.body;

  const errors = [];

  if (!name) {
    errors.push('Current name is required');
  }

  if (!newName) {
    errors.push('New name is required');
  } else if (typeof newName !== 'string') {
    errors.push('New name must be a string');
  } else if (newName.trim().length === 0) {
    errors.push('New name cannot be empty');
  }

  if (errors.length > 0) {
    return next(new ValidationError('Validation failed', errors));
  }

  next();
}

/**
 * Validate move/copy request
 */
function validateMoveOrCopy(req, res, next) {
  const { items, destination } = req.body;

  const errors = [];

  if (!Array.isArray(items)) {
    errors.push('Items must be an array');
  } else if (items.length === 0) {
    errors.push('At least one item is required');
  } else {
    // Validate each item has name property
    items.forEach((item, index) => {
      if (!item.name) {
        errors.push(`Item at index ${index} must have a name`);
      }
    });
  }

  if (destination === undefined || destination === null) {
    errors.push('Destination is required');
  }

  if (errors.length > 0) {
    return next(new ValidationError('Validation failed', errors));
  }

  next();
}

/**
 * Validate delete request
 */
function validateDelete(req, res, next) {
  const { items } = req.body;

  const errors = [];

  if (!Array.isArray(items)) {
    errors.push('Items must be an array');
  } else if (items.length === 0) {
    errors.push('At least one item is required');
  } else {
    // Validate each item has name property
    items.forEach((item, index) => {
      if (!item.name) {
        errors.push(`Item at index ${index} must have a name`);
      }
    });
  }

  if (errors.length > 0) {
    return next(new ValidationError('Validation failed', errors));
  }

  next();
}

module.exports = {
  validateCreateFolder,
  validateRename,
  validateMoveOrCopy,
  validateDelete
};
