/**
 * Auth Controller
 * HTTP handlers for authentication endpoints
 */

const { sendSuccess, sendCreated } = require('../../../shared/helpers/response.helper');
const { AuthDto, UserDto } = require('../dtos');
const logger = require('../../../shared/logger/logger');

class AuthController {
  constructor({ loginUseCase, setupUseCase, logoutUseCase, changePasswordUseCase, authService, usersService }) {
    this.loginUseCase = loginUseCase;
    this.setupUseCase = setupUseCase;
    this.logoutUseCase = logoutUseCase;
    this.changePasswordUseCase = changePasswordUseCase;
    this.authService = authService;
    this.usersService = usersService;
  }

  /**
   * POST /api/v1/auth/login
   * Login with email and password
   */
  async login(req, res, next) {
    try {
      const { email, password } = req.body;

      const result = await this.loginUseCase.execute({
        email,
        password,
        req
      });

      logger.info({ userId: result.user.id }, 'User logged in');

      return sendSuccess(res, AuthDto.loginResponse(result.user));
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/auth/setup
   * Create first admin user
   */
  async setup(req, res, next) {
    try {
      const { email, username, password } = req.body;

      const result = await this.setupUseCase.execute({
        email,
        username,
        password,
        req
      });

      logger.info({ userId: result.user.id }, 'Setup completed');

      return sendCreated(res, AuthDto.setupResponse(result.user));
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/auth/logout
   * Logout current user
   */
  async logout(req, res, next) {
    try {
      await this.logoutUseCase.execute({ req });

      logger.info('User logged out');

      return sendSuccess(res, { message: 'Logged out successfully' });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/auth/status
   * Get authentication status
   */
  async getStatus(req, res, next) {
    try {
      const status = await this.authService.getAuthStatus(req);

      return sendSuccess(res, AuthDto.statusResponse(status));
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/auth/oidc/login
   * Initiate OIDC login
   */
  async oidcLogin(req, res, next) {
    try {
      // Check if OIDC is configured
      const config = require('../../../shared/config');
      const oidcConfig = config.auth.oidc || {};

      if (!oidcConfig.enabled) {
        return res.status(404).json({
          success: false,
          error: { message: 'OIDC is not configured' }
        });
      }

      // Check if express-openid-connect middleware is available
      if (res.oidc && typeof res.oidc.login === 'function') {
        const redirect = req.query.redirect || '/';
        await res.oidc.login({ returnTo: redirect });
        return;
      }

      return res.status(404).json({
        success: false,
        error: { message: 'OIDC is not configured' }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/auth/me
   * Get current user
   */
  async getCurrentUser(req, res, next) {
    try {
      const user = this.authService.getCurrentUser(req);

      if (!user) {
        return sendSuccess(res, null);
      }

      return sendSuccess(res, UserDto.toPublic(user));
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/auth/password
   * Change password
   */
  async changePassword(req, res, next) {
    try {
      const user = this.authService.getCurrentUser(req);
      const { currentPassword, newPassword } = req.body;

      await this.changePasswordUseCase.execute({
        userId: user.id,
        currentPassword,
        newPassword
      });

      logger.info({ userId: user.id }, 'Password changed');

      return sendSuccess(res, { message: 'Password changed successfully' });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AuthController;
