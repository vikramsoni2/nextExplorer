/**
 * Auth Locks Repository
 * Data access layer for auth_locks table (brute force protection)
 */

const BaseRepository = require('./base.repository');
const { addMinutes, isPast } = require('../../../shared/utils/date.util');

class AuthLocksRepository extends BaseRepository {
  constructor(db) {
    super(db, 'auth_locks');
  }

  /**
   * Get lock status for key
   * @param {string} key - Lock key (e.g., email)
   * @returns {Object} - Lock status
   */
  getLockStatus(key) {
    const normalizedKey = key.toLowerCase().trim();
    const stmt = this.db.prepare('SELECT * FROM auth_locks WHERE key = ?');
    const row = stmt.get(normalizedKey);

    if (!row) {
      return {
        isLocked: false,
        failedCount: 0,
        lockedUntil: null
      };
    }

    const isLocked = row.locked_until && !isPast(row.locked_until);

    return {
      isLocked,
      failedCount: row.failed_count,
      lockedUntil: row.locked_until
    };
  }

  /**
   * Record failed login attempt
   * @param {string} key - Lock key
   * @param {number} maxAttempts - Max failed attempts before lock
   * @param {number} lockMinutes - Duration of lock in minutes
   */
  recordFailedAttempt(key, maxAttempts = 5, lockMinutes = 15) {
    const normalizedKey = key.toLowerCase().trim();
    const stmt = this.db.prepare('SELECT * FROM auth_locks WHERE key = ?');
    const existing = stmt.get(normalizedKey);

    if (!existing) {
      // First failed attempt
      const insertStmt = this.db.prepare(`
        INSERT INTO auth_locks (key, failed_count, locked_until)
        VALUES (?, 1, NULL)
      `);
      insertStmt.run(normalizedKey);
      return;
    }

    const newCount = existing.failed_count + 1;
    let lockedUntil = existing.locked_until;

    // Lock account if max attempts reached
    if (newCount >= maxAttempts) {
      lockedUntil = addMinutes(new Date(), lockMinutes).toISOString();
    }

    const updateStmt = this.db.prepare(`
      UPDATE auth_locks
      SET failed_count = ?, locked_until = ?
      WHERE key = ?
    `);
    updateStmt.run(newCount, lockedUntil, normalizedKey);
  }

  /**
   * Clear failed attempts (on successful login)
   * @param {string} key - Lock key
   */
  clearFailedAttempts(key) {
    const normalizedKey = key.toLowerCase().trim();
    const stmt = this.db.prepare('DELETE FROM auth_locks WHERE key = ?');
    stmt.run(normalizedKey);
  }

  /**
   * Check if key is currently locked
   * @param {string} key - Lock key
   * @returns {boolean} - True if locked
   */
  isLocked(key) {
    const status = this.getLockStatus(key);
    return status.isLocked;
  }

  /**
   * Clear expired locks (maintenance)
   */
  clearExpiredLocks() {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      DELETE FROM auth_locks
      WHERE locked_until IS NOT NULL AND locked_until < ?
    `);
    const result = stmt.run(now);
    return result.changes;
  }

  /**
   * Map database row to entity
   * @param {Object} row - Database row
   * @returns {Object} - Auth lock entity
   */
  mapToEntity(row) {
    if (!row) return null;

    return {
      key: row.key,
      failedCount: row.failed_count,
      lockedUntil: row.locked_until,
      isLocked: row.locked_until && !isPast(row.locked_until)
    };
  }
}

module.exports = AuthLocksRepository;
