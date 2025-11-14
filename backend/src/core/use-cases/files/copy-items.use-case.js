/**
 * Copy Items Use Case
 */

const { ValidationError } = require('../../../shared/errors');
const { combineRelativePath } = require('../../../shared/utils/path.util');

class CopyItemsUseCase {
  constructor({ fileSystemService }) {
    this.fileSystemService = fileSystemService;
  }

  async execute({ items, destination }) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new ValidationError('Items array is required');
    }

    if (destination === undefined || destination === null) {
      throw new ValidationError('Destination is required');
    }

    const results = [];
    const errors = [];

    for (const item of items) {
      try {
        const { path: itemPath, name } = item;
        const srcPath = combineRelativePath(itemPath || '', name);
        const destPath = combineRelativePath(destination, name);

        await this.fileSystemService.copy(srcPath, destPath);

        results.push({
          name,
          from: srcPath,
          to: destPath,
          success: true
        });
      } catch (error) {
        errors.push({
          name: item.name,
          error: error.message
        });
      }
    }

    return {
      success: results.length,
      failed: errors.length,
      results,
      errors
    };
  }
}

module.exports = CopyItemsUseCase;
