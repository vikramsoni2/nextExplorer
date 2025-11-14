/**
 * Files Controller
 * File operations endpoints
 */

const { sendSuccess, sendCreated } = require('../../../shared/helpers/response.helper');
const { FileDto } = require('../dtos');
const logger = require('../../../shared/logger/logger');

class FilesController {
  constructor({
    createFolderUseCase,
    renameItemUseCase,
    moveItemsUseCase,
    copyItemsUseCase,
    deleteItemsUseCase,
    fileSystemService
  }) {
    this.createFolderUseCase = createFolderUseCase;
    this.renameItemUseCase = renameItemUseCase;
    this.moveItemsUseCase = moveItemsUseCase;
    this.copyItemsUseCase = copyItemsUseCase;
    this.deleteItemsUseCase = deleteItemsUseCase;
    this.fileSystemService = fileSystemService;
  }

  /**
   * POST /api/v1/files/folder
   * Create new folder
   */
  async createFolder(req, res, next) {
    try {
      const { path, name } = req.body;

      const result = await this.createFolderUseCase.execute({ path, name });

      logger.info({ path: result.path }, 'Folder created');

      return sendCreated(res, result, 'Folder created successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/files/rename
   * Rename file or folder
   */
  async rename(req, res, next) {
    try {
      const { path, name, newName } = req.body;

      const result = await this.renameItemUseCase.execute({ path, name, newName });

      logger.info({ from: result.oldPath, to: result.newPath }, 'Item renamed');

      return sendSuccess(res, result, 'Renamed successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/files/move
   * Move files/folders
   */
  async move(req, res, next) {
    try {
      const { items, destination } = req.body;

      const result = await this.moveItemsUseCase.execute({ items, destination });

      logger.info({ success: result.success, failed: result.failed }, 'Items moved');

      return sendSuccess(res, result, `Moved ${result.success} item(s)`);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/files/copy
   * Copy files/folders
   */
  async copy(req, res, next) {
    try {
      const { items, destination } = req.body;

      const result = await this.copyItemsUseCase.execute({ items, destination });

      logger.info({ success: result.success, failed: result.failed }, 'Items copied');

      return sendSuccess(res, result, `Copied ${result.success} item(s)`);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/files
   * Delete files/folders
   */
  async delete(req, res, next) {
    try {
      const { items } = req.body;

      const result = await this.deleteItemsUseCase.execute({ items });

      logger.info({ success: result.success, failed: result.failed }, 'Items deleted');

      return sendSuccess(res, result, `Deleted ${result.success} item(s)`);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = FilesController;
