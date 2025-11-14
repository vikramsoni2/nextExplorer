/**
 * Create Folder Use Case
 */

const { ValidationError } = require('../../../shared/errors');

class CreateFolderUseCase {
  constructor({ fileSystemService }) {
    this.fileSystemService = fileSystemService;
  }

  async execute({ path, name }) {
    if (!name || typeof name !== 'string') {
      throw new ValidationError('Folder name is required');
    }

    const normalizedPath = path || '';
    const createdPath = await this.fileSystemService.createDirectory(normalizedPath, name);

    return {
      path: createdPath,
      name
    };
  }
}

module.exports = CreateFolderUseCase;
