/**
 * Browse Routes
 * Directory browsing API routes
 */

const express = require('express');

/**
 * Create browse routes
 */
function createBrowseRoutes(browseController, authMiddleware) {
  const router = express.Router();

  // All routes require authentication
  router.use(authMiddleware);

  // Browse directory - wildcard route must be last
  router.get('/*', browseController.listDirectory.bind(browseController));

  return router;
}

module.exports = createBrowseRoutes;
