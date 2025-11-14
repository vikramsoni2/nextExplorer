/**
 * Base Repository
 * Abstract base class for all repositories
 * Provides common CRUD operations
 */

class BaseRepository {
  /**
   * @param {Database} db - SQLite database instance
   * @param {string} tableName - Name of the table
   */
  constructor(db, tableName) {
    this.db = db;
    this.tableName = tableName;
  }

  /**
   * Find record by ID
   * @param {string} id - Record ID
   * @returns {Object|null} - Record or null if not found
   */
  findById(id) {
    const stmt = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE id = ?`);
    const row = stmt.get(id);
    return row ? this.mapToEntity(row) : null;
  }

  /**
   * Find all records
   * @returns {Array} - All records
   */
  findAll() {
    const stmt = this.db.prepare(`SELECT * FROM ${this.tableName}`);
    const rows = stmt.all();
    return rows.map(row => this.mapToEntity(row));
  }

  /**
   * Find records by condition
   * @param {Object} where - Where conditions
   * @returns {Array} - Matching records
   */
  findBy(where) {
    const keys = Object.keys(where);
    const conditions = keys.map(key => `${key} = ?`).join(' AND ');
    const values = keys.map(key => where[key]);

    const stmt = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE ${conditions}`);
    const rows = stmt.all(...values);
    return rows.map(row => this.mapToEntity(row));
  }

  /**
   * Find one record by condition
   * @param {Object} where - Where conditions
   * @returns {Object|null} - Record or null
   */
  findOneBy(where) {
    const keys = Object.keys(where);
    const conditions = keys.map(key => `${key} = ?`).join(' AND ');
    const values = keys.map(key => where[key]);

    const stmt = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE ${conditions} LIMIT 1`);
    const row = stmt.get(...values);
    return row ? this.mapToEntity(row) : null;
  }

  /**
   * Count records
   * @param {Object} where - Where conditions (optional)
   * @returns {number} - Count
   */
  count(where = null) {
    if (!where) {
      const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM ${this.tableName}`);
      return stmt.get().count;
    }

    const keys = Object.keys(where);
    const conditions = keys.map(key => `${key} = ?`).join(' AND ');
    const values = keys.map(key => where[key]);

    const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM ${this.tableName} WHERE ${conditions}`);
    return stmt.get(...values).count;
  }

  /**
   * Delete record by ID
   * @param {string} id - Record ID
   * @returns {boolean} - True if deleted
   */
  deleteById(id) {
    const stmt = this.db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`);
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Execute raw query
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @returns {Array} - Results
   */
  query(sql, params = []) {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params);
  }

  /**
   * Execute raw query (single result)
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @returns {Object|null} - Result or null
   */
  queryOne(sql, params = []) {
    const stmt = this.db.prepare(sql);
    return stmt.get(...params) || null;
  }

  /**
   * Map database row to entity
   * Override this in child classes
   * @param {Object} row - Database row
   * @returns {Object} - Entity
   */
  mapToEntity(row) {
    return row;
  }

  /**
   * Map entity to database row
   * Override this in child classes
   * @param {Object} entity - Entity
   * @returns {Object} - Database row
   */
  mapToRow(entity) {
    return entity;
  }

  /**
   * Begin transaction
   */
  beginTransaction() {
    this.db.prepare('BEGIN').run();
  }

  /**
   * Commit transaction
   */
  commit() {
    this.db.prepare('COMMIT').run();
  }

  /**
   * Rollback transaction
   */
  rollback() {
    this.db.prepare('ROLLBACK').run();
  }

  /**
   * Run function in transaction
   * @param {Function} fn - Function to run
   * @returns {*} - Function result
   */
  transaction(fn) {
    return this.db.transaction(fn)();
  }
}

module.exports = BaseRepository;
