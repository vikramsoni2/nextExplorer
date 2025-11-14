/**
 * Settings Controller
 * Settings management endpoints
 */

const { sendSuccess } = require('../../../shared/helpers/response.helper');

class SettingsController {
  constructor({ settingsService }) {
    this.settingsService = settingsService;
  }

  /**
   * GET /api/v1/settings
   * Get global settings
   */
  async getGlobalSettings(req, res, next) {
    try {
      const settings = await this.settingsService.getGlobalSettings();
      return sendSuccess(res, settings);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/v1/settings
   * Update global settings (admin only)
   */
  async updateGlobalSettings(req, res, next) {
    try {
      const updates = req.body;
      const settings = await this.settingsService.updateGlobalSettings(updates);
      return sendSuccess(res, settings, 'Global settings updated');
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/settings/user
   * Get user-specific settings
   */
  async getUserSettings(req, res, next) {
    try {
      const userId = req.session.user.id;
      const settings = await this.settingsService.getUserSettings(userId);
      return sendSuccess(res, settings);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/v1/settings/user
   * Update user-specific settings
   */
  async updateUserSettings(req, res, next) {
    try {
      const userId = req.session.user.id;
      const updates = req.body;
      const settings = await this.settingsService.updateUserSettings(userId, updates);
      return sendSuccess(res, settings, 'User settings updated');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = SettingsController;
