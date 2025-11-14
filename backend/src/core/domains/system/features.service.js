/**
 * Features Service
 * Feature flags and announcements
 */

const config = require('../../../shared/config');
const logger = require('../../../shared/logger/logger');

class FeaturesService {
  constructor({ db }) {
    this.db = db;
  }

  /**
   * Get enabled features
   */
  async getFeatures() {
    const features = {
      onlyoffice: {
        enabled: Boolean(config.onlyoffice?.serverUrl),
        extensions: Array.isArray(config.onlyoffice?.extensions) ? config.onlyoffice.extensions : [],
      },
      volumeUsage: {
        enabled: Boolean(config.features?.volumeUsage),
      },
      announcements: []
    };

    // Read announcements from database
    try {
      const getMeta = this.db.prepare('SELECT value FROM meta WHERE key = ?').pluck();
      const raw = getMeta.get('notice_migration_v3');

      if (raw) {
        try {
          const notice = JSON.parse(raw);
          if (notice && notice.pending) {
            features.announcements.push({
              id: 'v3-user-migration',
              level: 'info',
              title: 'We\'ve updated how you sign in',
              message: 'You now need to use your new email-style username. To sign in, add @example.local to your username (for example: username@example.local). Your password stays the same.',
              once: true,
            });
          }
        } catch (parseError) {
          logger.warn({ error: parseError.message }, 'Failed to parse announcement');
        }
      }
    } catch (error) {
      // DB may not be initialized or meta table missing; announcements are optional
      logger.debug({ error: error.message }, 'Could not read announcements from DB');
    }

    return features;
  }
}

module.exports = FeaturesService;
