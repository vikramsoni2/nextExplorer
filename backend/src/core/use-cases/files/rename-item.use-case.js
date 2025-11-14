/**
 * Rename Item Use Case
 */

const { ValidationError } = require('../../../shared/errors');
const { combineRelativePath } = require('../../../shared/utils/path.util');

class RenameItemUseCase {
  constructor({ fileSystemService }) {
    this.fileSystemService = fileSystemService;
  }

  async execute({ path, name, newName }) {
    if (!name) {
      throw new ValidationError('Current name is required');
    }

    if (!newName || typeof newName !== 'string') {
      throw new ValidationError('New name is required');
    }

    if (name === newName) {
      throw new ValidationError('New name must be different');
    }

    const itemPath = combineRelativePath(path || '', name);
    const newPath = await this.fileSystemService.rename(itemPath, newName);

    return {
      oldPath: itemPath,
      newPath,
      newName
    };
  }
}

module.exports = RenameItemUseCase;
