/**
 * Authentication Configuration
 * Auth-related settings
 */

const crypto = require('crypto');
const env = require('./env.config');
const { parseScopes } = require('../utils/env.util');

/**
 * Determine auth mode: 'local', 'oidc', 'both', or 'disabled'
 */
const determineAuthMode = () => {
  if (env.AUTH_MODE) {
    const validModes = ['local', 'oidc', 'both', 'disabled'];
    if (!validModes.includes(env.AUTH_MODE)) {
      console.warn(`[Config] Invalid AUTH_MODE="${env.AUTH_MODE}". Using "both" as default.`);
      return 'both';
    }
    return env.AUTH_MODE;
  }
  return 'both';
};

const authMode = determineAuthMode();

// Get callback URL from env or construct from public URL
const getCallbackUrl = () => {
  if (env.OIDC_CALLBACK_URL) {
    return env.OIDC_CALLBACK_URL;
  }

  const appConfig = require('./app.config');
  if (appConfig.public.url) {
    return `${appConfig.public.url}/callback`;
  }

  return null;
};

module.exports = {
  enabled: authMode === 'disabled' ? false : (env.AUTH_ENABLED !== false),
  mode: authMode,

  session: {
    secret: env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    name: 'connect.sid'
  },

  lockout: {
    maxFailedAttempts: env.AUTH_MAX_FAILED,
    lockDurationMinutes: env.AUTH_LOCK_MINUTES
  },

  oidc: {
    enabled: env.OIDC_ENABLED ?? null,
    issuer: env.OIDC_ISSUER,
    authorizationURL: env.OIDC_AUTHORIZATION_URL,
    tokenURL: env.OIDC_TOKEN_URL,
    userInfoURL: env.OIDC_USERINFO_URL,
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
    callbackUrl: getCallbackUrl(),
    scopes: parseScopes(env.OIDC_SCOPES) || null,
    adminGroups: parseScopes(env.OIDC_ADMIN_GROUPS) || null,
    requireEmailVerified: env.OIDC_REQUIRE_EMAIL_VERIFIED
  }
};
