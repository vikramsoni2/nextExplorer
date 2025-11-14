/**
 * Authentication Middleware
 * Checks if user is authenticated
 */

const { AuthenticationError } = require('../../../shared/errors');

/**
 * Create auth middleware
 * @param {Object} authService - Auth service instance
 * @returns {Function} - Express middleware function
 */
function createAuthMiddleware(authService) {
  return async function authMiddleware(req, res, next) {
    // Check OIDC authentication first (from express-openid-connect)
    const isOidcAuth = Boolean(
      req.oidc &&
      typeof req.oidc.isAuthenticated === 'function' &&
      req.oidc.isAuthenticated()
    );

    if (isOidcAuth && req.oidc.user) {
      // User authenticated via OIDC
      // The OIDC middleware's afterCallback should have already synced the user to DB
      // We need to look up the user from the database using the OIDC claims
      const config = require('../../../shared/config');
      const { getRepositories } = require('../../../infrastructure/database');

      try {
        const repositories = await getRepositories();
        const issuer = config.auth.oidc?.issuer;
        const sub = req.oidc.user.sub;

        if (issuer && sub) {
          const authMethod = await repositories.authMethodsRepository.findOidcByIssuerAndSub(issuer, sub);
          if (authMethod) {
            const user = await repositories.usersRepository.findById(authMethod.userId);
            if (user) {
              req.user = user;
              req.session.user = user; // Also store in session for consistency
              return next();
            }
          }
        }
      } catch (error) {
        // Fall through to local auth check
      }
    }

    // Check local session authentication
    if (!authService.isAuthenticated(req)) {
      return next(new AuthenticationError('Authentication required'));
    }

    // Load user into request
    const user = authService.getCurrentUser(req);
    if (!user) {
      return next(new AuthenticationError('User not found'));
    }

    req.user = user;
    next();
  };
}

module.exports = createAuthMiddleware;
