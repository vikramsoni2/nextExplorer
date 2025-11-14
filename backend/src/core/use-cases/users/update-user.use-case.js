/**
 * Update User Use Case
 * Update user profile and roles (admin only)
 */

const { ValidationError, NotFoundError } = require('../../../shared/errors');
const { validateEmail } = require('../../../shared/utils/validation.util');

class UpdateUserUseCase {
  constructor({ usersRepository }) {
    this.usersRepo = usersRepository;
  }

  async execute({ userId, email, username, displayName, roles }) {
    // Get existing user
    const user = await this.usersRepo.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    const updates = {};

    // Update roles if provided
    if (Array.isArray(roles)) {
      // Validate roles
      const validRoles = ['admin', 'user'];
      for (const role of roles) {
        if (!validRoles.includes(role)) {
          throw new ValidationError(`Invalid role: ${role}. Valid roles are: ${validRoles.join(', ')}`);
        }
      }

      // Prevent admin demotion
      const wasAdmin = user.roles.includes('admin');
      const willBeAdmin = roles.includes('admin');
      if (wasAdmin && !willBeAdmin) {
        throw new ValidationError('Demotion of admin is not allowed');
      }

      updates.roles = roles;
    }

    // Update email if provided
    if (email !== undefined && email !== null) {
      if (typeof email !== 'string' || email.trim().length === 0) {
        throw new ValidationError('Email must be a non-empty string');
      }

      const emailValidation = validateEmail(email);
      if (!emailValidation.isValid) {
        throw new ValidationError(emailValidation.error);
      }

      updates.email = email.toLowerCase().trim();
    }

    // Update username if provided
    if (username !== undefined && username !== null) {
      if (typeof username !== 'string' || username.trim().length === 0) {
        throw new ValidationError('Username must be a non-empty string');
      }
      updates.username = username.trim();
    }

    // Update displayName if provided
    if (displayName !== undefined && displayName !== null) {
      if (typeof displayName !== 'string' || displayName.trim().length === 0) {
        throw new ValidationError('Display name must be a non-empty string');
      }
      updates.displayName = displayName.trim();
    }

    // If no updates, return existing user
    if (Object.keys(updates).length === 0) {
      return {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        roles: user.roles,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      };
    }

    // Update user
    const updatedUser = await this.usersRepo.update(userId, updates);

    return {
      id: updatedUser.id,
      email: updatedUser.email,
      username: updatedUser.username,
      displayName: updatedUser.displayName,
      roles: updatedUser.roles,
      createdAt: updatedUser.createdAt,
      updatedAt: updatedUser.updatedAt
    };
  }
}

module.exports = UpdateUserUseCase;
