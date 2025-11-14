/**
 * Logout Use Case
 * Handles user logout workflow
 */

class LogoutUseCase {
  constructor({ authService }) {
    this.authService = authService;
  }

  /**
   * Execute logout
   * @param {Object} params - Logout parameters
   * @param {Object} params.req - Express request object
   * @returns {Promise<void>}
   */
  async execute({ req }) {
    await this.authService.logout(req);
  }
}

module.exports = LogoutUseCase;
