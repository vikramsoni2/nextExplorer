/**
 * Metadata Routes
 * Metadata extraction API routes
 */

const express = require('express');

/**
 * Create metadata routes
 */
function createMetadataRoutes(metadataController, authMiddleware) {
  const router = express.Router();

  // Require authentication
  router.use(authMiddleware);

  // Get metadata for file (GET with wildcard)
  router.get('/*', metadataController.getMetadata.bind(metadataController));

  return router;
}

module.exports = createMetadataRoutes;
