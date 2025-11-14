/**
 * Authentication Service
 * Core authentication logic
 */

const {
  InvalidCredentialsError,
  AccountLockedError,
  UserNotFoundError
} = require('../../../shared/errors');
const passwordService = require('./password.service');
const sessionService = require('./session.service');
const config = require('../../../shared/config');
const logger = require('../../../shared/logger/logger');

class AuthService {
  constructor(repositories) {
    this.usersRepo = repositories.users;
    this.authMethodsRepo = repositories.authMethods;
    this.authLocksRepo = repositories.authLocks;
  }

  /**
   * Authenticate user with email and password
   * @param {string} email - User email
   * @param {string} password - Plain text password
   * @returns {Promise<Object>} - User object if authenticated
   * @throws {AccountLockedError} - If account is locked
   * @throws {InvalidCredentialsError} - If credentials are invalid
   */
  async authenticateWithPassword(email, password) {
    const normalizedEmail = email.toLowerCase().trim();

    // Check if account is locked
    const lockStatus = this.authLocksRepo.getLockStatus(normalizedEmail);
    if (lockStatus.isLocked) {
      logger.warn({ email: normalizedEmail }, 'Login attempt on locked account');
      throw new AccountLockedError(lockStatus.lockedUntil);
    }

    // Find user by email
    const user = this.usersRepo.findByEmail(normalizedEmail);
    if (!user) {
      // Record failed attempt even if user doesn't exist (prevent enumeration)
      this.authLocksRepo.recordFailedAttempt(
        normalizedEmail,
        config.auth.lockout.maxFailedAttempts,
        config.auth.lockout.lockDurationMinutes
      );
      throw new InvalidCredentialsError();
    }

    // Find local password auth method
    const authMethod = this.authMethodsRepo.findLocalPasswordByUserId(user.id);
    if (!authMethod || !authMethod.passwordHash) {
      this.authLocksRepo.recordFailedAttempt(
        normalizedEmail,
        config.auth.lockout.maxFailedAttempts,
        config.auth.lockout.lockDurationMinutes
      );
      throw new InvalidCredentialsError();
    }

    // Verify password
    const isValid = await passwordService.verify(password, authMethod.passwordHash);
    if (!isValid) {
      this.authLocksRepo.recordFailedAttempt(
        normalizedEmail,
        config.auth.lockout.maxFailedAttempts,
        config.auth.lockout.lockDurationMinutes
      );
      logger.warn({ email: normalizedEmail, userId: user.id }, 'Failed login attempt');
      throw new InvalidCredentialsError();
    }

    // Success - clear failed attempts
    this.authLocksRepo.clearFailedAttempts(normalizedEmail);

    // Update last used timestamp
    this.authMethodsRepo.updateLastUsed(authMethod.id);

    logger.info({ userId: user.id, email: normalizedEmail }, 'User authenticated successfully');

    return user;
  }

  /**
   * Create session for user
   * @param {Object} user - User object
   * @param {Object} req - Express request object
   * @returns {Promise<Object>} - Session info
   */
  async createSession(user, req) {
    return sessionService.create(user, req);
  }

  /**
   * Logout user
   * @param {Object} req - Express request object
   * @returns {Promise<void>}
   */
  async logout(req) {
    return sessionService.destroy(req);
  }

  /**
   * Get current user from session
   * @param {Object} req - Express request object
   * @returns {Object|null} - User or null
   */
  getCurrentUser(req) {
    const userId = sessionService.getUserId(req);
    if (!userId) {
      return null;
    }

    return this.usersRepo.findById(userId);
  }

  /**
   * Check if user is authenticated
   * @param {Object} req - Express request object
   * @returns {boolean} - True if authenticated
   */
  isAuthenticated(req) {
    return sessionService.exists(req);
  }

  /**
   * Get authentication status
   * @param {Object} req - Express request object
   * @returns {Object} - Auth status information
   */
  async getAuthStatus(req) {
    // Check both local and OIDC authentication
    let user = this.getCurrentUser(req);

    // Also check OIDC authentication
    const isOidcAuth = Boolean(
      req.oidc &&
      typeof req.oidc.isAuthenticated === 'function' &&
      req.oidc.isAuthenticated()
    );

    const userCount = this.usersRepo.count();

    // Skip setup requirement if AUTH_MODE is 'oidc' only
    const setupRequired = config.auth.enabled && config.auth.mode !== 'oidc' ? userCount === 0 : false;

    // Determine available auth strategies
    const strategies = [];
    const localEnabled = config.auth.mode === 'local' || config.auth.mode === 'both';
    const oidcEnabled = (config.auth.mode === 'oidc' || config.auth.mode === 'both') &&
                        Boolean(config.auth.oidc?.enabled);

    if (localEnabled) {
      strategies.push('local');
    }
    if (oidcEnabled) {
      strategies.push('oidc');
    }

    return {
      isAuthenticated: !!user || isOidcAuth,
      user: user || null,
      setupRequired,
      authModes: config.auth.mode,
      strategies,
      oidc: {
        enabled: oidcEnabled,
        issuer: oidcEnabled ? config.auth.oidc?.issuer : null,
        scopes: oidcEnabled ? config.auth.oidc?.scopes : []
      }
    };
  }
}

module.exports = AuthService;
