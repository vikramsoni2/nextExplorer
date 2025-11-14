/**
 * Delete User Use Case
 * Delete a user (admin only, with safeguards)
 */

const { ValidationError, NotFoundError } = require('../../../shared/errors');

class DeleteUserUseCase {
  constructor({ usersRepository, authMethodsRepository }) {
    this.usersRepo = usersRepository;
    this.authMethodsRepo = authMethodsRepository;
  }

  async execute({ userId, currentUserId }) {
    // Prevent self-deletion
    if (userId === currentUserId) {
      throw new ValidationError('You cannot delete your own account');
    }

    // Get user to delete
    const user = await this.usersRepo.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // If deleting an admin, ensure it's not the last admin
    if (user.roles.includes('admin')) {
      const adminCount = await this.usersRepo.countByRole('admin');
      if (adminCount <= 1) {
        throw new ValidationError('Cannot remove the last admin');
      }
    }

    // Delete user's auth methods
    const authMethods = await this.authMethodsRepo.findByUserId(userId);
    for (const authMethod of authMethods) {
      await this.authMethodsRepo.delete(authMethod.id);
    }

    // Delete user
    await this.usersRepo.delete(userId);

    return { success: true };
  }
}

module.exports = DeleteUserUseCase;
