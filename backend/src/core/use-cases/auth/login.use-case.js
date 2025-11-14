/**
 * Login Use Case
 * Handles user login workflow
 */

const { InvalidCredentialsError, ValidationError } = require('../../../shared/errors');
const { isValidEmail } = require('../../../shared/utils/validation.util');

class LoginUseCase {
  constructor({ authService }) {
    this.authService = authService;
  }

  /**
   * Execute login
   * @param {Object} params - Login parameters
   * @param {string} params.email - User email
   * @param {string} params.password - User password
   * @param {Object} params.req - Express request object
   * @returns {Promise<Object>} - Login result with user and session
   */
  async execute({ email, password, req }) {
    // Validate inputs
    if (!email || !password) {
      throw new ValidationError('Email and password are required');
    }

    if (!isValidEmail(email)) {
      throw new ValidationError('Invalid email address');
    }

    // Authenticate user
    const user = await this.authService.authenticateWithPassword(email, password);

    // Create session
    const session = await this.authService.createSession(user, req);

    return {
      user,
      session
    };
  }
}

module.exports = LoginUseCase;
