/**
 * Repositories Index
 * Export all repository classes
 */

const BaseRepository = require('./base.repository');
const UsersRepository = require('./users.repository');
const AuthMethodsRepository = require('./auth-methods.repository');
const AuthLocksRepository = require('./auth-locks.repository');

/**
 * Initialize all repositories with database instance
 * @param {Database} db - Database instance
 * @returns {Object} - Repository instances
 */
function initializeRepositories(db) {
  return {
    users: new UsersRepository(db),
    authMethods: new AuthMethodsRepository(db),
    authLocks: new AuthLocksRepository(db)
  };
}

module.exports = {
  BaseRepository,
  UsersRepository,
  AuthMethodsRepository,
  AuthLocksRepository,
  initializeRepositories
};
