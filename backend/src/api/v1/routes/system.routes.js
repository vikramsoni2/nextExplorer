/**
 * System Routes
 * System information API routes (features, volumes, usage)
 */

const express = require('express');

/**
 * Create system routes
 */
function createSystemRoutes(systemController, authMiddleware) {
  const router = express.Router();

  // Features endpoint (no auth required - needed for setup check)
  router.get('/features', systemController.getFeatures.bind(systemController));

  // Require authentication for other endpoints
  router.use(authMiddleware);

  // Volumes endpoint
  router.get('/volumes', systemController.getVolumes.bind(systemController));

  // Usage endpoint (with wildcard)
  router.get('/usage/*', systemController.getUsage.bind(systemController));

  return router;
}

module.exports = createSystemRoutes;
