/**
 * CORS Configuration
 * Cross-Origin Resource Sharing settings
 */

const env = require('./env.config');
const appConfig = require('./app.config');

/**
 * Build CORS configuration
 */
const buildCorsConfig = () => {
  if (env.CORS_ORIGINS) {
    if (env.CORS_ORIGINS === '*') {
      return { allowAll: true, origins: [] };
    }
    return {
      allowAll: false,
      origins: env.CORS_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    };
  }

  if (appConfig.public.origin) {
    return { allowAll: false, origins: [appConfig.public.origin] };
  }

  // Backwards compatibility - allow all
  return { allowAll: true, origins: [] };
};

const corsConfig = buildCorsConfig();

const corsOptions = {
  origin: (origin, callback) => {
    if (corsConfig.allowAll || !origin || corsConfig.origins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
};

module.exports = corsOptions;
