/**
 * Setup Use Case
 * Handles initial application setup (first admin user creation)
 */

const { ValidationError, ForbiddenError } = require('../../../shared/errors');
const { isValidEmail } = require('../../../shared/utils/validation.util');
const config = require('../../../shared/config');

class SetupUseCase {
  constructor({ usersService, authService }) {
    this.usersService = usersService;
    this.authService = authService;
  }

  /**
   * Execute setup
   * @param {Object} params - Setup parameters
   * @param {string} params.email - Admin email
   * @param {string} params.username - Admin username
   * @param {string} params.password - Admin password
   * @param {Object} params.req - Express request object (optional)
   * @returns {Promise<Object>} - Created admin user
   */
  async execute({ email, username, password, req = null }) {
    // Check if setup is allowed
    if (config.auth.mode === 'oidc') {
      throw new ForbiddenError('Setup is disabled when AUTH_MODE is set to oidc');
    }

    // Validate inputs
    if (!email || !password) {
      throw new ValidationError('Email and password are required');
    }

    if (!isValidEmail(email)) {
      throw new ValidationError('Invalid email address');
    }

    if (!username || username.trim().length < 3) {
      throw new ValidationError('Username must be at least 3 characters');
    }

    // Create first admin user
    const user = await this.usersService.createFirstAdmin({
      email,
      username: username.trim(),
      password
    });

    // Optionally create session if request object provided
    let session = null;
    if (req) {
      session = await this.authService.createSession(user, req);
    }

    return {
      user,
      session
    };
  }
}

module.exports = SetupUseCase;
