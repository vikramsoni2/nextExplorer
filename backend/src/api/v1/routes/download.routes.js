/**
 * Download Routes
 * File download API routes
 */

const express = require('express');

/**
 * Create download routes
 */
function createDownloadRoutes(downloadController, authMiddleware) {
  const router = express.Router();

  // Require authentication
  router.use(authMiddleware);

  // Download single file (GET with wildcard)
  router.get('/*', downloadController.downloadSingle.bind(downloadController));

  return router;
}

module.exports = createDownloadRoutes;
