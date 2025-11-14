/**
 * Logger Configuration
 * Configures logging levels and options
 */

const { normalizeBoolean } = require('../utils/env.util');

const supportedLevels = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']);

/**
 * Sanitize log level to supported values
 */
const sanitizeLevel = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return supportedLevels.has(normalized) ? normalized : null;
};

/**
 * Resolve log level from environment
 */
const resolvedLogLevel =
  sanitizeLevel(process.env.LOG_LEVEL) ||
  (normalizeBoolean(process.env.DEBUG) === true ? 'debug' : 'info');

const isDebugLevel = resolvedLogLevel === 'debug' || resolvedLogLevel === 'trace';
const enableHttpLogging = normalizeBoolean(process.env.ENABLE_HTTP_LOGGING) || false;

module.exports = {
  level: resolvedLogLevel,
  isDebug: isDebugLevel,
  enableHttpLogging,
  supportedLevels: Array.from(supportedLevels)
};
