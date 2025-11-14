/**
 * Search Configuration
 * Search feature settings
 */

const env = require('./env.config');
const { parseByteSize } = require('../utils/env.util');

// Parse max file size for content search
const searchMaxFileSizeBytes = (() => {
  const parsed = parseByteSize(env.SEARCH_MAX_FILESIZE);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5 * 1024 * 1024; // Default 5MB
})();

module.exports = {
  deep: env.SEARCH_DEEP ?? true,
  ripgrep: env.SEARCH_RIPGREP ?? true,
  maxFileSize: env.SEARCH_MAX_FILESIZE,
  maxFileSizeBytes: searchMaxFileSizeBytes
};
