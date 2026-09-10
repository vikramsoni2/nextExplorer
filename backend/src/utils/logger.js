const pino = require('pino');
const loggingConfig = require('../config/logging');

const prettyOptions = {
  colorize: true,
  levelFirst: true,
  translateTime: 'SYS:standard',
  ignore: 'pid,hostname',
};

// Keep development formatting in-process. The worker-backed Pino transport can
// crash under Node's watch runner while the worker is starting or stopping.
const prettyStream = loggingConfig.isDebug ? require('pino-pretty')(prettyOptions) : undefined;

const logger = pino(
  {
    level: loggingConfig.level,
    base: { service: 'nextExplorer-backend' },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  prettyStream
);

logger.debug({ level: loggingConfig.level }, 'Logger initialized');

// Alias used by some parts of the codebase (and for readability).
logger.warning = logger.warn.bind(logger);

module.exports = logger;
