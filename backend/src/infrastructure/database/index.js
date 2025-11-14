/**
 * Database Infrastructure Index
 * Export database connection and repositories
 */

const { getDb, getDbSync, getDbPath, closeDb } = require('./sqlite/connection');
const { initializeRepositories } = require('./repositories');

let repositories = null;

/**
 * Get initialized repositories
 * @returns {Promise<Object>} - Repository instances
 */
async function getRepositories() {
  if (repositories) {
    return repositories;
  }

  const db = await getDb();
  repositories = initializeRepositories(db);
  return repositories;
}

/**
 * Get repositories synchronously (must be initialized first)
 * @returns {Object} - Repository instances
 */
function getRepositoriesSync() {
  if (!repositories) {
    const db = getDbSync();
    repositories = initializeRepositories(db);
  }
  return repositories;
}

module.exports = {
  getDb,
  getDbSync,
  getDbPath,
  closeDb,
  getRepositories,
  getRepositoriesSync
};
