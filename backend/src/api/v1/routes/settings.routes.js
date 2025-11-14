/**
 * Settings Routes
 * Settings management API routes
 */

const express = require('express');

/**
 * Create settings routes
 */
function createSettingsRoutes(settingsController, authMiddleware, adminMiddleware) {
  const router = express.Router();

  // Require authentication
  router.use(authMiddleware);

  // Global settings (read-only for non-admins)
  router.get('/', settingsController.getGlobalSettings.bind(settingsController));

  // Global settings (admin only)
  router.put('/', adminMiddleware, settingsController.updateGlobalSettings.bind(settingsController));

  // User settings
  router.get('/user', settingsController.getUserSettings.bind(settingsController));
  router.put('/user', settingsController.updateUserSettings.bind(settingsController));

  return router;
}

module.exports = createSettingsRoutes;
