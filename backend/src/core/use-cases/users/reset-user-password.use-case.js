/**
 * Reset User Password Use Case
 * Admin resets a user's password
 */

const { ValidationError, NotFoundError } = require('../../../shared/errors');
const { validatePassword } = require('../../../shared/utils/validation.util');

class ResetUserPasswordUseCase {
  constructor({ usersRepository, authMethodsRepository, passwordService }) {
    this.usersRepo = usersRepository;
    this.authMethodsRepo = authMethodsRepository;
    this.passwordService = passwordService;
  }

  async execute({ userId, newPassword }) {
    // Get existing user
    const user = await this.usersRepo.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Validate password
    if (!newPassword || typeof newPassword !== 'string') {
      throw new ValidationError('New password is required');
    }

    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.isValid) {
      throw new ValidationError(passwordValidation.error);
    }

    // Get user's local auth method
    const authMethod = await this.authMethodsRepo.findByUserIdAndProvider(userId, 'local');
    if (!authMethod) {
      throw new ValidationError('User does not have a local password authentication method');
    }

    // Hash new password
    const passwordHash = await this.passwordService.hash(newPassword);

    // Update auth method
    await this.authMethodsRepo.update(authMethod.id, {
      passwordHash
    });

    return { success: true };
  }
}

module.exports = ResetUserPasswordUseCase;
