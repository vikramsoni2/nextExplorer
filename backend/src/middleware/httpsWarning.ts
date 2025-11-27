import type { Express, NextFunction, Request, Response } from 'express';
const logger = require('../utils/logger');

/**
 * One-time warning middleware for HTTPS detection
 * Warns operators when HTTPS is detected to ensure proper configuration
 */
const configureHttpsWarning = (app: Express): void => {
  let warnedInsecureOverHttps = false;
  
  app.use((req: Request, _res: Response, next: NextFunction) => {
    try {
      const isHttps = req.secure || 
        (req.headers['x-forwarded-proto'] || '').toString().split(',')[0].trim() === 'https';
      
      if (isHttps && !warnedInsecureOverHttps) {
        warnedInsecureOverHttps = true;
        logger.warn(
          'HTTPS detected. Ensure upstream proxy is trusted and OIDC cookies are set secure when OIDC is enabled.'
        );
      } else if (!isHttps) {
        logger.debug('Non-HTTPS request detected');
      }
    } catch (_) {}
    next();
  });
  
  logger.debug('HTTPS warning middleware configured');
};

module.exports = { configureHttpsWarning };
