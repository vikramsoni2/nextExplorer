/**
 * Password Service
 * Handles password hashing and verification
 */

const bcrypt = require('bcryptjs');
const { ValidationError } = require('../../../shared/errors');
const { validatePassword } = require('../../../shared/utils/validation.util');

const SALT_ROUNDS = 10;

class PasswordService {
  /**
   * Hash password
   * @param {string} password - Plain text password
   * @returns {Promise<string>} - Hashed password
   */
  async hash(password) {
    if (!password || typeof password !== 'string') {
      throw new ValidationError('Password is required');
    }

    return bcrypt.hash(password, SALT_ROUNDS);
  }

  /**
   * Verify password against hash
   * @param {string} password - Plain text password
   * @param {string} hash - Password hash
   * @returns {Promise<boolean>} - True if password matches
   */
  async verify(password, hash) {
    if (!password || !hash) {
      return false;
    }

    try {
      return await bcrypt.compare(password, hash);
    } catch (error) {
      return false;
    }
  }

  /**
   * Validate password strength
   * @param {string} password - Password to validate
   * @param {Object} options - Validation options
   * @returns {{valid: boolean, errors: string[]}} - Validation result
   */
  validateStrength(password, options = {}) {
    return validatePassword(password, {
      minLength: 8,
      requireUppercase: false,
      requireLowercase: false,
      requireNumbers: false,
      requireSpecialChars: false,
      ...options
    });
  }

  /**
   * Validate and hash password
   * @param {string} password - Plain text password
   * @param {Object} options - Validation options
   * @returns {Promise<string>} - Hashed password
   */
  async validateAndHash(password, options = {}) {
    const validation = this.validateStrength(password, options);

    if (!validation.valid) {
      throw new ValidationError('Password validation failed', validation.errors);
    }

    return this.hash(password);
  }
}

module.exports = new PasswordService();
