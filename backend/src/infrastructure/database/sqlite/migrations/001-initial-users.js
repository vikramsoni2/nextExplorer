/**
 * Migration 001: Initial Users Table
 * Creates the initial users table with basic authentication
 */

const logger = require('../../../../shared/logger/logger');

const up = (db) => {
  logger.info('Running migration 001: Initial users table');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL CHECK(provider IN ('local','oidc')),
      username TEXT UNIQUE,
      password_hash TEXT,
      password_algo TEXT,
      oidc_issuer TEXT,
      oidc_sub TEXT,
      display_name TEXT,
      email TEXT,
      roles TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oidc ON users(oidc_issuer, oidc_sub);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  `);

  logger.info('Migration 001 completed');
};

const down = (db) => {
  db.exec(`
    DROP INDEX IF EXISTS idx_users_username;
    DROP INDEX IF EXISTS idx_users_oidc;
    DROP TABLE IF EXISTS users;
  `);
};

module.exports = { up, down };
