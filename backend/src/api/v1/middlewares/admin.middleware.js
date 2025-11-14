/**
 * Admin Middleware
 * Ensures user has admin role
 */

const { AuthorizationError } = require('../../../shared/errors');

/**
 * Create admin middleware
 */
function createAdminMiddleware() {
  return function adminMiddleware(req, res, next) {
    const user = req.session?.user;

    if (!user) {
      return next(new AuthorizationError('Authentication required'));
    }

    const roles = Array.isArray(user.roles) ? user.roles : [];

    if (!roles.includes('admin')) {
      return next(new AuthorizationError('Admin access required'));
    }

    next();
  };
}

module.exports = createAdminMiddleware;
