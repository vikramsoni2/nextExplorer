/**
 * Upload Routes
 * File upload API routes
 */

const express = require('express');

/**
 * Create upload routes
 */
function createUploadRoutes(uploadController, uploadMiddleware, authMiddleware) {
  const router = express.Router();

  // Require authentication
  router.use(authMiddleware);

  // Upload files (multipart/form-data)
  router.post('/', uploadMiddleware.array('files', 50), uploadController.upload.bind(uploadController));

  return router;
}

module.exports = createUploadRoutes;
