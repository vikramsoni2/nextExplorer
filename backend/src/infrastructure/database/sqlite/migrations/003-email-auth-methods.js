/**
 * Migration 003: Email-centric Authentication
 * Refactors users table to be email-centric and adds auth_methods table
 */

const logger = require('../../../../shared/logger/logger');
const { generateId } = require('../../../../shared/utils/crypto.util');

const up = (db) => {
  logger.info('Running migration 003: Email-centric authentication');

  // Create new tables
  db.exec(`
    CREATE TABLE users_new (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      email_verified INTEGER DEFAULT 0,
      username TEXT,
      display_name TEXT,
      roles TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE auth_methods (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      method_type TEXT NOT NULL CHECK(method_type IN ('local_password', 'oidc')),
      password_hash TEXT,
      password_algo TEXT DEFAULT 'bcrypt',
      provider_issuer TEXT,
      provider_sub TEXT,
      provider_name TEXT,
      enabled INTEGER DEFAULT 1,
      last_used_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users_new(id) ON DELETE CASCADE
    );
  `);

  // Migrate existing users
  const existingUsers = db.prepare('SELECT * FROM users').all();
  const preMigrationLocalCount = existingUsers.filter(u => u.provider === 'local').length;

  const insertUser = db.prepare(`
    INSERT INTO users_new (id, email, email_verified, username, display_name, roles, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAuth = db.prepare(`
    INSERT INTO auth_methods (id, user_id, method_type, password_hash, password_algo,
                               provider_issuer, provider_sub, provider_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  logger.info(`Migrating ${existingUsers.length} users to new schema`);

  for (const user of existingUsers) {
    // Generate email if missing (for old local users without email)
    const email = user.email || `${user.username || user.id}@example.local`;
    const emailVerified = user.email ? 1 : 0;

    // Insert user identity
    insertUser.run(
      user.id,
      email,
      emailVerified,
      user.username,
      user.display_name,
      user.roles,
      user.created_at,
      user.updated_at
    );

    // Insert auth method
    if (user.provider === 'local') {
      insertAuth.run(
        generateId(),
        user.id,
        'local_password',
        user.password_hash,
        user.password_algo || 'bcrypt',
        null, null, null,
        user.created_at
      );
    } else if (user.provider === 'oidc') {
      insertAuth.run(
        generateId(),
        user.id,
        'oidc',
        null, null,
        user.oidc_issuer,
        user.oidc_sub,
        'OIDC',
        user.created_at
      );
    }
  }

  // Replace old table with new one
  db.exec(`
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
    CREATE INDEX idx_users_email ON users(email);
    CREATE INDEX idx_auth_methods_user ON auth_methods(user_id);
    CREATE UNIQUE INDEX idx_auth_methods_oidc ON auth_methods(provider_issuer, provider_sub) WHERE method_type = 'oidc';
    CREATE INDEX idx_auth_methods_type ON auth_methods(method_type);
  `);

  // Set migration notice if local users were migrated
  if (preMigrationLocalCount > 0) {
    try {
      const notice = JSON.stringify({
        pending: true,
        localMigrated: preMigrationLocalCount,
        createdAt: new Date().toISOString()
      });
      db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run('notice_migration_v3', notice);
    } catch (error) {
      logger.warn({ error }, 'Could not set migration notice');
    }
  }

  logger.info('Migration 003 completed successfully');
};

const down = (db) => {
  // This migration is complex to reverse, so we won't support downgrade
  throw new Error('Migration 003 cannot be reversed');
};

module.exports = { up, down };
