/**
 * Thumbnail Routes
 * Thumbnail generation API routes
 */

const express = require('express');

/**
 * Create thumbnail routes
 */
function createThumbnailRoutes(thumbnailController, authMiddleware) {
  const router = express.Router();

  // Require authentication
  router.use(authMiddleware);

  // Get thumbnail for file (GET with wildcard)
  router.get('/*', thumbnailController.getThumbnail.bind(thumbnailController));

  return router;
}

module.exports = createThumbnailRoutes;
