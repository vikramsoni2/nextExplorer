/**
 * Delete Items Use Case
 */

const { ValidationError } = require('../../../shared/errors');
const { combineRelativePath } = require('../../../shared/utils/path.util');

class DeleteItemsUseCase {
  constructor({ fileSystemService }) {
    this.fileSystemService = fileSystemService;
  }

  async execute({ items }) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new ValidationError('Items array is required');
    }

    const results = [];
    const errors = [];

    for (const item of items) {
      try {
        const { path: itemPath, name } = item;
        const fullPath = combineRelativePath(itemPath || '', name);

        await this.fileSystemService.delete(fullPath);

        results.push({
          name,
          path: fullPath,
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

module.exports = DeleteItemsUseCase;
