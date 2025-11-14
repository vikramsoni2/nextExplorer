/**
 * SQLite Database Connection
 * Singleton database instance with automatic migration
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const logger = require('../../../shared/logger/logger');
const config = require('../../../shared/config');
const { ensureDir } = require('../../../shared/utils/file-system.util');
const { runMigrations } = require('./migrations/migration-runner');

let dbInstance = null;

/**
 * Get database file path
 * @returns {string} - Database path
 */
const getDbPath = () => {
  return path.join(config.directories.config, 'app.db');
};

/**
 * Get database instance (singleton)
 * @returns {Promise<Database>} - Database instance
 */
const getDb = async () => {
  if (dbInstance) {
    return dbInstance;
  }

  const dbDir = config.directories.config;
  await ensureDir(dbDir);
  const dbPath = getDbPath();

  // Ensure file exists
  try {
    if (!fs.existsSync(dbPath)) {
      fs.writeFileSync(dbPath, '');
      logger.debug({ dbPath }, 'Created new database file');
    }
  } catch (error) {
    logger.warn({ error, dbPath }, 'Could not create database file');
  }

  // Open database connection
  const db = new Database(dbPath);
  logger.info({ dbPath }, 'Database connection established');

  // Run migrations
  await runMigrations(db);

  dbInstance = db;
  return dbInstance;
};

/**
 * Close database connection
 */
const closeDb = () => {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    logger.info('Database connection closed');
  }
};

/**
 * Get database instance synchronously (must be initialized first)
 * @returns {Database} - Database instance
 */
const getDbSync = () => {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call getDb() first.');
  }
  return dbInstance;
};

module.exports = {
  getDb,
  getDbSync,
  getDbPath,
  closeDb
};
