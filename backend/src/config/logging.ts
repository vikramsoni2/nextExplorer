import { normalizeBoolean } from '../utils/env';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

const supportedLevels = new Set<LogLevel>(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']);

const sanitizeLevel = (value: unknown): LogLevel | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase() as LogLevel;
  return supportedLevels.has(normalized) ? normalized : null;
};

const resolvedLogLevel: LogLevel =
  sanitizeLevel(process.env.LOG_LEVEL) ||
  (normalizeBoolean(process.env.DEBUG) === true ? 'debug' : 'info');

const isDebugLevel = resolvedLogLevel === 'debug' || resolvedLogLevel === 'trace';
const enableHttpLogging = normalizeBoolean(process.env.ENABLE_HTTP_LOGGING) || false;

const loggingConfig = {
  level: resolvedLogLevel,
  isDebug: isDebugLevel,
  enableHttpLogging: enableHttpLogging,
};

export default loggingConfig;
module.exports = loggingConfig;
