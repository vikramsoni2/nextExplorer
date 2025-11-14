/**
 * Settings Service
 * User and global settings management
 */

const { ValidationError } = require('../../../shared/errors');
const logger = require('../../../shared/logger/logger');

class SettingsService {
  constructor({ jsonStorageAdapter }) {
    this.storage = jsonStorageAdapter;
    this.settingsKey = 'app_settings';
    this.userSettingsPrefix = 'user_settings_';
  }

  /**
   * Get global settings
   */
  async getGlobalSettings() {
    const settings = await this.storage.get(this.settingsKey);
    return settings || this.getDefaultGlobalSettings();
  }

  /**
   * Update global settings
   */
  async updateGlobalSettings(updates) {
    const current = await this.getGlobalSettings();
    const merged = { ...current, ...updates };

    // Validate settings
    this.validateGlobalSettings(merged);

    await this.storage.set(this.settingsKey, merged);
    logger.info({ updates: Object.keys(updates) }, 'Global settings updated');

    return merged;
  }

  /**
   * Get user-specific settings
   */
  async getUserSettings(userId) {
    const key = `${this.userSettingsPrefix}${userId}`;
    const settings = await this.storage.get(key);
    return settings || this.getDefaultUserSettings();
  }

  /**
   * Update user-specific settings
   */
  async updateUserSettings(userId, updates) {
    const current = await this.getUserSettings(userId);
    const merged = { ...current, ...updates };

    // Validate settings
    this.validateUserSettings(merged);

    const key = `${this.userSettingsPrefix}${userId}`;
    await this.storage.set(key, merged);
    logger.info({ userId, updates: Object.keys(updates) }, 'User settings updated');

    return merged;
  }

  /**
   * Default global settings
   */
  getDefaultGlobalSettings() {
    return {
      allowSignup: false,
      allowedFileTypes: [],
      maxFileSize: 1024 * 1024 * 1024, // 1GB
      thumbnailsEnabled: true,
      searchEnabled: true,
      theme: 'light',
      language: 'en'
    };
  }

  /**
   * Default user settings
   */
  getDefaultUserSettings() {
    return {
      theme: 'light',
      language: 'en',
      viewMode: 'grid',
      sortBy: 'name',
      sortOrder: 'asc',
      showHidden: false,
      itemsPerPage: 50
    };
  }

  /**
   * Validate global settings
   */
  validateGlobalSettings(settings) {
    if (settings.maxFileSize !== undefined) {
      if (!Number.isInteger(settings.maxFileSize) || settings.maxFileSize < 0) {
        throw new ValidationError('maxFileSize must be a non-negative integer');
      }
    }

    if (settings.theme !== undefined) {
      const validThemes = ['light', 'dark', 'auto'];
      if (!validThemes.includes(settings.theme)) {
        throw new ValidationError(`theme must be one of: ${validThemes.join(', ')}`);
      }
    }

    if (settings.allowedFileTypes !== undefined && !Array.isArray(settings.allowedFileTypes)) {
      throw new ValidationError('allowedFileTypes must be an array');
    }
  }

  /**
   * Validate user settings
   */
  validateUserSettings(settings) {
    if (settings.theme !== undefined) {
      const validThemes = ['light', 'dark', 'auto'];
      if (!validThemes.includes(settings.theme)) {
        throw new ValidationError(`theme must be one of: ${validThemes.join(', ')}`);
      }
    }

    if (settings.viewMode !== undefined) {
      const validViewModes = ['grid', 'list'];
      if (!validViewModes.includes(settings.viewMode)) {
        throw new ValidationError(`viewMode must be one of: ${validViewModes.join(', ')}`);
      }
    }

    if (settings.sortBy !== undefined) {
      const validSortFields = ['name', 'size', 'modified', 'type'];
      if (!validSortFields.includes(settings.sortBy)) {
        throw new ValidationError(`sortBy must be one of: ${validSortFields.join(', ')}`);
      }
    }

    if (settings.sortOrder !== undefined) {
      const validSortOrders = ['asc', 'desc'];
      if (!validSortOrders.includes(settings.sortOrder)) {
        throw new ValidationError(`sortOrder must be one of: ${validSortOrders.join(', ')}`);
      }
    }

    if (settings.itemsPerPage !== undefined) {
      if (!Number.isInteger(settings.itemsPerPage) || settings.itemsPerPage < 1 || settings.itemsPerPage > 500) {
        throw new ValidationError('itemsPerPage must be an integer between 1 and 500');
      }
    }
  }
}

module.exports = SettingsService;
