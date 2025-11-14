/**
 * Auth Routes
 * Authentication API routes
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { validateLogin, validateSetup, validateChangePassword } = require('../validators/auth.validator');

// Rate limiters
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per window
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many login attempts. Please try again later.' } },
  standardHeaders: true,
  legacyHeaders: false
});

const setupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 requests per window
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many setup attempts. Please try again later.' } },
  standardHeaders: true,
  legacyHeaders: false
});

const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 requests per window
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many password change attempts. Please try again later.' } },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Create auth routes
 * @param {Object} authController - Auth controller instance
 * @param {Function} authMiddleware - Auth middleware function
 * @returns {express.Router} - Configured router
 */
function createAuthRoutes(authController, authMiddleware) {
  const router = express.Router();

  // Public routes
  router.get('/status', authController.getStatus.bind(authController));
  router.post('/setup', setupLimiter, validateSetup, authController.setup.bind(authController));
  router.post('/login', loginLimiter, validateLogin, authController.login.bind(authController));

  // OIDC routes
  router.get('/oidc/login', authController.oidcLogin.bind(authController));

  // Protected routes (require authentication)
  router.get('/me', authMiddleware, authController.getCurrentUser.bind(authController));
  router.post('/password', authMiddleware, passwordLimiter, validateChangePassword, authController.changePassword.bind(authController));
  router.post('/logout', authMiddleware, authController.logout.bind(authController));

  return router;
}

module.exports = createAuthRoutes;
