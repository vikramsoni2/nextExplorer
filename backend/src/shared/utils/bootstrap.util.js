/**
 * Bootstrap Utility
 * Application initialization tasks
 */

const { ensureDir } = require('./file-system.util');
const logger = require('../logger/logger');

/**
 * Bootstrap application (create necessary directories)
 * @param {Object} directories - Directory configuration
 */
const bootstrap = async (directories) => {
  logger.debug('Bootstrap start');

  const dirEntries = [
    ['config', directories.config],
    ['cache', directories.cache],
    ['thumbnails', directories.thumbnails]
  ];

  await Promise.all(dirEntries.map(async ([name, dir]) => {
    try {
      await ensureDir(dir);
      logger.debug({ dir }, `${name} directory ensured`);
    } catch (error) {
      logger.warn({ directory: dir, err: error }, `Unable to prepare ${name} directory`);
    }
  }));

  logger.debug('Bootstrap complete');
};

module.exports = { bootstrap };
