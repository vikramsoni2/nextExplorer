/**
 * Session Service
 * Handles user session management
 */

const logger = require('../../../shared/logger/logger');

class SessionService {
  /**
   * Create session for user
   * @param {Object} user - User object
   * @param {Object} req - Express request object
   * @returns {Promise<Object>} - Session info
   */
  async create(user, req) {
    if (!req.session) {
      throw new Error('Session middleware not initialized');
    }

    // Store user ID in session
    req.session.localUserId = user.id;

    logger.debug({ userId: user.id }, 'Session created');

    return {
      userId: user.id,
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Destroy session
   * @param {Object} req - Express request object
   * @returns {Promise<void>}
   */
  async destroy(req) {
    return new Promise((resolve, reject) => {
      if (!req.session) {
        return resolve();
      }

      const userId = req.session.localUserId;

      req.session.destroy((err) => {
        if (err) {
          logger.error({ err, userId }, 'Failed to destroy session');
          return reject(err);
        }

        logger.debug({ userId }, 'Session destroyed');
        resolve();
      });
    });
  }

  /**
   * Get user ID from session
   * @param {Object} req - Express request object
   * @returns {string|null} - User ID or null
   */
  getUserId(req) {
    return req.session?.localUserId || null;
  }

  /**
   * Check if session exists
   * @param {Object} req - Express request object
   * @returns {boolean} - True if session exists
   */
  exists(req) {
    return !!this.getUserId(req);
  }

  /**
   * Refresh session (update last access time)
   * @param {Object} req - Express request object
   */
  refresh(req) {
    if (req.session) {
      req.session.touch();
    }
  }
}

module.exports = new SessionService();
