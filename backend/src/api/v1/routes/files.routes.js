/**
 * Files Routes
 * File operations API routes
 */

const express = require('express');
const {
  validateCreateFolder,
  validateRename,
  validateMoveOrCopy,
  validateDelete
} = require('../validators/files.validator');

/**
 * Create files routes
 */
function createFilesRoutes(filesController, authMiddleware) {
  const router = express.Router();

  // All routes require authentication
  router.use(authMiddleware);

  // File operations
  router.post('/folder', validateCreateFolder, filesController.createFolder.bind(filesController));
  router.post('/rename', validateRename, filesController.rename.bind(filesController));
  router.post('/move', validateMoveOrCopy, filesController.move.bind(filesController));
  router.post('/copy', validateMoveOrCopy, filesController.copy.bind(filesController));
  router.delete('/', validateDelete, filesController.delete.bind(filesController));

  return router;
}

module.exports = createFilesRoutes;
