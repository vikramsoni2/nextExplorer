/**
 * Users Repository
 * Data access layer for users table
 */

const BaseRepository = require('./base.repository');
const { UserNotFoundError } = require('../../../shared/errors');

class UsersRepository extends BaseRepository {
  constructor(db) {
    super(db, 'users');
  }

  /**
   * Find user by email
   * @param {string} email - Email address
   * @returns {Object|null} - User or null
   */
  findByEmail(email) {
    if (!email) return null;

    const normalizedEmail = email.toLowerCase().trim();
    const stmt = this.db.prepare('SELECT * FROM users WHERE LOWER(email) = ?');
    const row = stmt.get(normalizedEmail);

    return row ? this.mapToEntity(row) : null;
  }

  /**
   * Find user by username
   * @param {string} username - Username
   * @returns {Object|null} - User or null
   */
  findByUsername(username) {
    if (!username) return null;

    const stmt = this.db.prepare('SELECT * FROM users WHERE username = ?');
    const row = stmt.get(username);

    return row ? this.mapToEntity(row) : null;
  }

  /**
   * Create new user
   * @param {Object} userData - User data
   * @returns {Object} - Created user
   */
  create(userData) {
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO users (
        id, email, email_verified, username, display_name, roles, created_at, updated_at
      ) VALUES (
        @id, @email, @email_verified, @username, @display_name, @roles, @created_at, @updated_at
      )
    `);

    stmt.run({
      id: userData.id,
      email: userData.email.toLowerCase().trim(),
      email_verified: userData.emailVerified ? 1 : 0,
      username: userData.username || null,
      display_name: userData.displayName || null,
      roles: JSON.stringify(userData.roles || []),
      created_at: userData.createdAt || now,
      updated_at: userData.updatedAt || now
    });

    return this.findById(userData.id);
  }

  /**
   * Update user
   * @param {string} id - User ID
   * @param {Object} updates - Fields to update
   * @returns {Object} - Updated user
   */
  update(id, updates) {
    const user = this.findById(id);
    if (!user) {
      throw new UserNotFoundError(id);
    }

    const allowedFields = ['email', 'email_verified', 'username', 'display_name', 'roles'];
    const fields = [];
    const values = {};

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        const dbKey = key === 'emailVerified' ? 'email_verified' :
                      key === 'displayName' ? 'display_name' : key;

        fields.push(`${dbKey} = @${dbKey}`);

        if (key === 'email') {
          values[dbKey] = updates[key].toLowerCase().trim();
        } else if (key === 'emailVerified') {
          values[dbKey] = updates[key] ? 1 : 0;
        } else if (key === 'roles') {
          values[dbKey] = JSON.stringify(updates[key]);
        } else {
          values[dbKey] = updates[key];
        }
      }
    });

    if (fields.length === 0) {
      return user;
    }

    fields.push('updated_at = @updated_at');
    values.updated_at = new Date().toISOString();
    values.id = id;

    const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = @id`;
    const stmt = this.db.prepare(sql);
    stmt.run(values);

    return this.findById(id);
  }

  /**
   * Count users with specific role
   * @param {string} role - Role name
   * @returns {number} - Count
   */
  countByRole(role) {
    // Since roles is JSON array, we use LIKE to search
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM users
      WHERE roles LIKE ?
    `);
    return stmt.get(`%"${role}"%`).count;
  }

  /**
   * Check if user has role
   * @param {string} id - User ID
   * @param {string} role - Role name
   * @returns {boolean} - True if user has role
   */
  hasRole(id, role) {
    const user = this.findById(id);
    if (!user) return false;

    const roles = JSON.parse(user.roles || '[]');
    return roles.includes(role);
  }

  /**
   * Map database row to entity
   * @param {Object} row - Database row
   * @returns {Object} - User entity
   */
  mapToEntity(row) {
    if (!row) return null;

    return {
      id: row.id,
      email: row.email,
      emailVerified: Boolean(row.email_verified),
      username: row.username,
      displayName: row.display_name,
      roles: JSON.parse(row.roles || '[]'),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

module.exports = UsersRepository;
