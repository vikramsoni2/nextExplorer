/**
 * Change Password Use Case
 * Handles password change workflow
 */

const { ValidationError, AuthenticationError } = require('../../../shared/errors');

class ChangePasswordUseCase {
  constructor({ usersService }) {
    this.usersService = usersService;
  }

  /**
   * Execute password change
   * @param {Object} params - Parameters
   * @param {string} params.userId - User ID
   * @param {string} params.currentPassword - Current password
   * @param {string} params.newPassword - New password
   * @returns {Promise<void>}
   */
  async execute({ userId, currentPassword, newPassword }) {
    // Validate inputs
    if (!userId) {
      throw new AuthenticationError('User not authenticated');
    }

    if (!currentPassword || !newPassword) {
      throw new ValidationError('Current password and new password are required');
    }

    if (currentPassword === newPassword) {
      throw new ValidationError('New password must be different from current password');
    }

    // Change password
    await this.usersService.changePassword(userId, currentPassword, newPassword);
  }
}

module.exports = ChangePasswordUseCase;
