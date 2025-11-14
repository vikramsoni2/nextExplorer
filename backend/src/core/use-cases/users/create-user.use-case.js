/**
 * Create User Use Case
 * Create a new local user with password (admin only)
 */

const { ValidationError, ConflictError } = require('../../../shared/errors');
const { validateEmail, validatePassword } = require('../../../shared/utils/validation.util');

class CreateUserUseCase {
  constructor({ usersRepository, authMethodsRepository, passwordService }) {
    this.usersRepo = usersRepository;
    this.authMethodsRepo = authMethodsRepository;
    this.passwordService = passwordService;
  }

  async execute({ email, username, displayName, password, roles = [] }) {
    // Validate email
    if (!email || typeof email !== 'string') {
      throw new ValidationError('Email is required');
    }

    const emailValidation = validateEmail(email);
    if (!emailValidation.isValid) {
      throw new ValidationError(emailValidation.error);
    }

    // Check if user already exists
    const existingUser = await this.usersRepo.findByEmail(email);
    if (existingUser) {
      throw new ConflictError('User with this email already exists');
    }

    // Validate password
    if (!password || typeof password !== 'string') {
      throw new ValidationError('Password is required');
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      throw new ValidationError(passwordValidation.error);
    }

    // Validate roles
    const validRoles = ['admin', 'user'];
    const userRoles = Array.isArray(roles) ? roles : [];
    for (const role of userRoles) {
      if (!validRoles.includes(role)) {
        throw new ValidationError(`Invalid role: ${role}. Valid roles are: ${validRoles.join(', ')}`);
      }
    }

    // Default to 'user' role if no roles specified
    const finalRoles = userRoles.length > 0 ? userRoles : ['user'];

    // Create user
    const user = await this.usersRepo.create({
      email: email.toLowerCase().trim(),
      username: username || email.split('@')[0],
      displayName: displayName || username || email.split('@')[0],
      roles: finalRoles
    });

    // Hash password
    const passwordHash = await this.passwordService.hash(password);

    // Create auth method
    await this.authMethodsRepo.create({
      userId: user.id,
      provider: 'local',
      email: email.toLowerCase().trim(),
      passwordHash
    });

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      roles: user.roles,
      createdAt: user.createdAt
    };
  }
}

module.exports = CreateUserUseCase;
