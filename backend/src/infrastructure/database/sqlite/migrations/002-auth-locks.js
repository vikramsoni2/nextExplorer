/**
 * Migration 002: Auth Locks Table
 * Creates table for tracking failed authentication attempts
 */

const logger = require('../../../../shared/logger/logger');

const up = (db) => {
  logger.info('Running migration 002: Auth locks table');

  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_locks (
      key TEXT PRIMARY KEY,
      failed_count INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT
    );
  `);

  logger.info('Migration 002 completed');
};

const down = (db) => {
  db.exec(`DROP TABLE IF EXISTS auth_locks;`);
};

module.exports = { up, down };
