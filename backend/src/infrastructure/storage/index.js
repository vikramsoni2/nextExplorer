/**
 * Storage Adapters Index
 * Export all storage adapters
 */

const jsonStorage = require('./json-storage.adapter');
const FileSystemAdapter = require('./file-system.adapter');
const cache = require('./cache.adapter');

module.exports = {
  jsonStorage,
  FileSystemAdapter,
  cache
};
