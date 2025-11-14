/**
 * Auth Methods Repository
 * Data access layer for auth_methods table
 */

const BaseRepository = require('./base.repository');

class AuthMethodsRepository extends BaseRepository {
  constructor(db) {
    super(db, 'auth_methods');
  }

  /**
   * Find auth methods by user ID
   * @param {string} userId - User ID
   * @returns {Array} - Auth methods
   */
  findByUserId(userId) {
    const stmt = this.db.prepare('SELECT * FROM auth_methods WHERE user_id = ?');
    const rows = stmt.all(userId);
    return rows.map(row => this.mapToEntity(row));
  }

  /**
   * Find local password auth method for user
   * @param {string} userId - User ID
   * @returns {Object|null} - Auth method or null
   */
  findLocalPasswordByUserId(userId) {
    const stmt = this.db.prepare(`
      SELECT * FROM auth_methods
      WHERE user_id = ? AND method_type = 'local_password' AND enabled = 1
      LIMIT 1
    `);
    const row = stmt.get(userId);
    return row ? this.mapToEntity(row) : null;
  }

  /**
   * Find auth method by user ID and provider
   * @param {string} userId - User ID
   * @param {string} provider - Provider name ('local', 'oidc')
   * @returns {Object|null} - Auth method or null
   */
  findByUserIdAndProvider(userId, provider) {
    const methodType = provider === 'local' ? 'local_password' : provider;
    const stmt = this.db.prepare(`
      SELECT * FROM auth_methods
      WHERE user_id = ? AND method_type = ?
      LIMIT 1
    `);
    const row = stmt.get(userId, methodType);
    return row ? this.mapToEntity(row) : null;
  }

  /**
   * Find OIDC auth method by issuer and subject
   * @param {string} issuer - OIDC issuer
   * @param {string} sub - OIDC subject
   * @returns {Object|null} - Auth method or null
   */
  findOidcByIssuerAndSub(issuer, sub) {
    const stmt = this.db.prepare(`
      SELECT * FROM auth_methods
      WHERE provider_issuer = ? AND provider_sub = ? AND method_type = 'oidc'
      LIMIT 1
    `);
    const row = stmt.get(issuer, sub);
    return row ? this.mapToEntity(row) : null;
  }

  /**
   * Create new auth method
   * @param {Object} authData - Auth method data
   * @returns {Object} - Created auth method
   */
  create(authData) {
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO auth_methods (
        id, user_id, method_type, password_hash, password_algo,
        provider_issuer, provider_sub, provider_name, enabled, last_used_at, created_at
      ) VALUES (
        @id, @user_id, @method_type, @password_hash, @password_algo,
        @provider_issuer, @provider_sub, @provider_name, @enabled, @last_used_at, @created_at
      )
    `);

    stmt.run({
      id: authData.id,
      user_id: authData.userId,
      method_type: authData.methodType,
      password_hash: authData.passwordHash || null,
      password_algo: authData.passwordAlgo || 'bcrypt',
      provider_issuer: authData.providerIssuer || null,
      provider_sub: authData.providerSub || null,
      provider_name: authData.providerName || null,
      enabled: authData.enabled !== false ? 1 : 0,
      last_used_at: authData.lastUsedAt || null,
      created_at: authData.createdAt || now
    });

    return this.findById(authData.id);
  }

  /**
   * Update auth method
   * @param {string} id - Auth method ID
   * @param {Object} updates - Fields to update
   * @returns {Object} - Updated auth method
   */
  update(id, updates) {
    const allowedFields = ['password_hash', 'password_algo', 'enabled', 'last_used_at'];
    const fields = [];
    const values = {};

    Object.keys(updates).forEach(key => {
      const dbKey = key === 'passwordHash' ? 'password_hash' :
                    key === 'passwordAlgo' ? 'password_algo' :
                    key === 'lastUsedAt' ? 'last_used_at' : key;

      if (allowedFields.includes(dbKey)) {
        fields.push(`${dbKey} = @${dbKey}`);
        if (key === 'enabled') {
          values[dbKey] = updates[key] ? 1 : 0;
        } else {
          values[dbKey] = updates[key];
        }
      }
    });

    if (fields.length === 0) {
      return this.findById(id);
    }

    values.id = id;
    const sql = `UPDATE auth_methods SET ${fields.join(', ')} WHERE id = @id`;
    const stmt = this.db.prepare(sql);
    stmt.run(values);

    return this.findById(id);
  }

  /**
   * Update last used timestamp
   * @param {string} id - Auth method ID
   */
  updateLastUsed(id) {
    const stmt = this.db.prepare('UPDATE auth_methods SET last_used_at = ? WHERE id = ?');
    stmt.run(new Date().toISOString(), id);
  }

  /**
   * Map database row to entity
   * @param {Object} row - Database row
   * @returns {Object} - Auth method entity
   */
  mapToEntity(row) {
    if (!row) return null;

    return {
      id: row.id,
      userId: row.user_id,
      methodType: row.method_type,
      passwordHash: row.password_hash,
      passwordAlgo: row.password_algo,
      providerIssuer: row.provider_issuer,
      providerSub: row.provider_sub,
      providerName: row.provider_name,
      enabled: Boolean(row.enabled),
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at
    };
  }
}

module.exports = AuthMethodsRepository;
