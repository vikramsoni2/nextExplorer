/**
 * Migration Runner
 * Runs database migrations in order
 */

const logger = require('../../../../shared/logger/logger');

// Import migrations in order
const migrations = [
  require('./001-initial-users'),
  require('./002-auth-locks'),
  require('./003-email-auth-methods')
];

/**
 * Create meta table for tracking schema version
 * @param {Database} db - Database instance
 */
const createMetaTable = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
};

/**
 * Get current schema version
 * @param {Database} db - Database instance
 * @returns {number} - Current version
 */
const getCurrentVersion = (db) => {
  const stmt = db.prepare('SELECT value FROM meta WHERE key = ?');
  const row = stmt.get('schema_version');
  return row ? Number(row.value) : 0;
};

/**
 * Set schema version
 * @param {Database} db - Database instance
 * @param {number} version - Version number
 */
const setVersion = (db, version) => {
  const stmt = db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)');
  stmt.run('schema_version', String(version));
};

/**
 * Run all pending migrations
 * @param {Database} db - Database instance
 */
const runMigrations = (db) => {
  logger.info('Checking for pending migrations');

  createMetaTable(db);
  let currentVersion = getCurrentVersion(db);

  logger.info({ currentVersion, totalMigrations: migrations.length }, 'Migration status');

  if (currentVersion >= migrations.length) {
    logger.info('Database is up to date');
    return;
  }

  // Run migrations in a transaction
  db.transaction(() => {
    for (let i = currentVersion; i < migrations.length; i++) {
      const migrationNumber = i + 1;
      const migration = migrations[i];

      logger.info({ migrationNumber }, 'Running migration');

      try {
        migration.up(db);
        setVersion(db, migrationNumber);
        logger.info({ migrationNumber }, 'Migration completed');
      } catch (error) {
        logger.error({ error, migrationNumber }, 'Migration failed');
        throw error;
      }
    }
  })();

  const finalVersion = getCurrentVersion(db);
  logger.info({ finalVersion }, 'All migrations completed successfully');
};

/**
 * Rollback last migration (use with caution)
 * @param {Database} db - Database instance
 */
const rollbackMigration = (db) => {
  const currentVersion = getCurrentVersion(db);

  if (currentVersion === 0) {
    logger.warn('No migrations to rollback');
    return;
  }

  const migrationIndex = currentVersion - 1;
  const migration = migrations[migrationIndex];

  logger.warn({ migrationNumber: currentVersion }, 'Rolling back migration');

  db.transaction(() => {
    migration.down(db);
    setVersion(db, currentVersion - 1);
  })();

  logger.info({ newVersion: currentVersion - 1 }, 'Migration rolled back');
};

module.exports = {
  runMigrations,
  rollbackMigration,
  getCurrentVersion
};
