/**
 * Server Entry Point
 * Starts the HTTP server
 */

const { initializeApp } = require('./app');
const config = require('./shared/config');
const logger = require('./shared/logger/logger');
const { closeDb } = require('./infrastructure/database');

let server;

/**
 * Start server
 */
async function start() {
  try {
    const app = await initializeApp();

    server = app.listen(config.port, () => {
      logger.info({
        port: config.port,
        nodeEnv: config.nodeEnv
      }, `Server listening on port ${config.port}`);
      logger.info(`🚀 Server ready at http://localhost:${config.port}`);
    });

    // Graceful shutdown
    const gracefulShutdown = (signal) => {
      logger.info({ signal }, 'Received shutdown signal');

      server.close(() => {
        logger.info('HTTP server closed');

        // Close database connection
        closeDb();

        logger.info('Graceful shutdown completed');
        process.exit(0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

// Start server if this file is run directly
if (require.main === module) {
  start();
}

module.exports = { start };
