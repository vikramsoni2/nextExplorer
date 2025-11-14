/**
 * Users Service
 * User management and operations
 */

const {
  UserNotFoundError,
  DuplicateError,
  ValidationError,
  ForbiddenError
} = require('../../../shared/errors');
const { generateId } = require('../../../shared/utils/crypto.util');
const { isValidEmail } = require('../../../shared/utils/validation.util');
const passwordService = require('../auth/password.service');
const logger = require('../../../shared/logger/logger');
const { ROLES } = require('../../../shared/constants');

class UsersService {
  constructor(repositories) {
    this.usersRepo = repositories.users;
    this.authMethodsRepo = repositories.authMethods;
  }

  /**
   * Get user by ID
   * @param {string} id - User ID
   * @returns {Object|null} - User or null
   */
  getById(id) {
    return this.usersRepo.findById(id);
  }

  /**
   * Get user by email
   * @param {string} email - User email
   * @returns {Object|null} - User or null
   */
  getByEmail(email) {
    return this.usersRepo.findByEmail(email);
  }

  /**
   * Get all users
   * @returns {Array} - All users
   */
  getAllUsers() {
    return this.usersRepo.findAll();
  }

  /**
   * Count total users
   * @returns {number} - User count
   */
  countUsers() {
    return this.usersRepo.count();
  }

  /**
   * Count admin users
   * @returns {number} - Admin count
   */
  countAdmins() {
    return this.usersRepo.countByRole(ROLES.ADMIN);
  }

  /**
   * Create local user with password
   * @param {Object} userData - User data
   * @param {string} userData.email - Email
   * @param {string} userData.username - Username (optional)
   * @param {string} userData.password - Password
   * @param {string[]} userData.roles - Roles (optional)
   * @returns {Object} - Created user
   */
  async createLocalUser(userData) {
    const { email, username, password, roles = [] } = userData;

    // Validate email
    if (!isValidEmail(email)) {
      throw new ValidationError('Invalid email address');
    }

    // Check if user already exists
    const existing = this.usersRepo.findByEmail(email);
    if (existing) {
      throw new DuplicateError('User', 'email', email);
    }

    // Validate and hash password
    const passwordHash = await passwordService.validateAndHash(password);

    // Create user
    const userId = generateId();
    const now = new Date().toISOString();

    const user = this.usersRepo.create({
      id: userId,
      email: email.toLowerCase().trim(),
      emailVerified: true, // Local users are considered verified
      username: username || null,
      displayName: username || email.split('@')[0],
      roles,
      createdAt: now,
      updatedAt: now
    });

    // Create local password auth method
    this.authMethodsRepo.create({
      id: generateId(),
      userId: user.id,
      methodType: 'local_password',
      passwordHash,
      passwordAlgo: 'bcrypt',
      enabled: true,
      createdAt: now
    });

    logger.info({ userId: user.id, email: user.email }, 'Local user created');

    return user;
  }

  /**
   * Create first admin user (setup)
   * @param {Object} userData - User data
   * @returns {Object} - Created admin user
   */
  async createFirstAdmin(userData) {
    // Check if users already exist
    const userCount = this.countUsers();
    if (userCount > 0) {
      throw new ForbiddenError('Setup already completed. Users already exist.');
    }

    // Create user with admin role
    return this.createLocalUser({
      ...userData,
      roles: [ROLES.ADMIN]
    });
  }

  /**
   * Update user
   * @param {string} id - User ID
   * @param {Object} updates - Fields to update
   * @returns {Object} - Updated user
   */
  updateUser(id, updates) {
    const user = this.usersRepo.findById(id);
    if (!user) {
      throw new UserNotFoundError(id);
    }

    return this.usersRepo.update(id, updates);
  }

  /**
   * Delete user
   * @param {string} id - User ID
   * @returns {boolean} - True if deleted
   */
  deleteUser(id) {
    const user = this.usersRepo.findById(id);
    if (!user) {
      throw new UserNotFoundError(id);
    }

    // Prevent deleting last admin
    if (this.hasRole(id, ROLES.ADMIN)) {
      const adminCount = this.countAdmins();
      if (adminCount <= 1) {
        throw new ForbiddenError('Cannot delete the last admin user');
      }
    }

    return this.usersRepo.deleteById(id);
  }

  /**
   * Change user password
   * @param {string} userId - User ID
   * @param {string} currentPassword - Current password
   * @param {string} newPassword - New password
   * @returns {Promise<void>}
   */
  async changePassword(userId, currentPassword, newPassword) {
    const user = this.usersRepo.findById(userId);
    if (!user) {
      throw new UserNotFoundError(userId);
    }

    // Get local password auth method
    const authMethod = this.authMethodsRepo.findLocalPasswordByUserId(userId);
    if (!authMethod) {
      throw new ValidationError('User does not have a local password');
    }

    // Verify current password
    const isValid = await passwordService.verify(currentPassword, authMethod.passwordHash);
    if (!isValid) {
      throw new ValidationError('Current password is incorrect');
    }

    // Hash new password
    const newPasswordHash = await passwordService.validateAndHash(newPassword);

    // Update auth method
    this.authMethodsRepo.update(authMethod.id, {
      passwordHash: newPasswordHash,
      passwordAlgo: 'bcrypt'
    });

    logger.info({ userId }, 'Password changed successfully');
  }

  /**
   * Check if user has role
   * @param {string} id - User ID
   * @param {string} role - Role name
   * @returns {boolean} - True if user has role
   */
  hasRole(id, role) {
    return this.usersRepo.hasRole(id, role);
  }

  /**
   * Check if user is admin
   * @param {string} id - User ID
   * @returns {boolean} - True if admin
   */
  isAdmin(id) {
    return this.hasRole(id, ROLES.ADMIN);
  }

  /**
   * Get user auth methods
   * @param {string} userId - User ID
   * @returns {Array} - Auth methods
   */
  getUserAuthMethods(userId) {
    return this.authMethodsRepo.findByUserId(userId);
  }
}

module.exports = UsersService;
