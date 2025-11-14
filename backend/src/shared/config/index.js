/**
 * Configuration Index
 * Main configuration export - combines all config modules
 */

const env = require('./env.config');
const appConfig = require('./app.config');
const authConfig = require('./auth.config');
const corsOptions = require('./cors.config');
const searchConfig = require('./search.config');
const onlyofficeConfig = require('./onlyoffice.config');
const loggingConfig = require('../logger/logger.config');
const constants = require('../constants');

module.exports = {
  // Environment
  env,

  // Application
  port: appConfig.port,
  nodeEnv: appConfig.nodeEnv,
  directories: appConfig.directories,
  files: appConfig.files,
  public: appConfig.public,
  thumbnails: appConfig.thumbnails,
  features: appConfig.features,
  trustProxy: appConfig.trustProxy,

  // File types & extensions
  extensions: {
    images: constants.IMAGE_EXTENSIONS,
    videos: constants.VIDEO_EXTENSIONS,
    documents: constants.DOCUMENT_EXTENSIONS,
    previewable: constants.PREVIEWABLE_EXTENSIONS
  },
  excludedFiles: constants.EXCLUDED_FILES,
  mimeTypes: constants.MIME_TYPES,

  // Auth & Security
  auth: authConfig,
  corsOptions,

  // Features
  search: searchConfig,
  onlyoffice: onlyofficeConfig,

  // Logging
  logging: {
    level: loggingConfig.level,
    isDebug: loggingConfig.isDebug,
    enableHttpLogging: loggingConfig.enableHttpLogging
  }
};
