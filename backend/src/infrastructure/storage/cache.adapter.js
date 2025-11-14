/**
 * Cache Adapter
 * Simple in-memory cache with TTL support
 */

class CacheAdapter {
  constructor() {
    this.cache = new Map();
    this.ttls = new Map();
  }

  /**
   * Set value in cache
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} ttl - Time to live in milliseconds (optional)
   */
  set(key, value, ttl = null) {
    this.cache.set(key, value);

    if (ttl) {
      const expiresAt = Date.now() + ttl;
      this.ttls.set(key, expiresAt);
    }
  }

  /**
   * Get value from cache
   * @param {string} key - Cache key
   * @returns {*} - Cached value or undefined
   */
  get(key) {
    // Check if expired
    if (this.isExpired(key)) {
      this.delete(key);
      return undefined;
    }

    return this.cache.get(key);
  }

  /**
   * Check if key exists in cache
   * @param {string} key - Cache key
   * @returns {boolean} - True if exists and not expired
   */
  has(key) {
    if (this.isExpired(key)) {
      this.delete(key);
      return false;
    }

    return this.cache.has(key);
  }

  /**
   * Delete key from cache
   * @param {string} key - Cache key
   * @returns {boolean} - True if deleted
   */
  delete(key) {
    this.ttls.delete(key);
    return this.cache.delete(key);
  }

  /**
   * Clear entire cache
   */
  clear() {
    this.cache.clear();
    this.ttls.clear();
  }

  /**
   * Get cache size
   * @returns {number} - Number of cached items
   */
  size() {
    return this.cache.size;
  }

  /**
   * Check if key is expired
   * @param {string} key - Cache key
   * @returns {boolean} - True if expired
   */
  isExpired(key) {
    const expiresAt = this.ttls.get(key);
    if (!expiresAt) return false;

    return Date.now() > expiresAt;
  }

  /**
   * Get or set value (lazy loading)
   * @param {string} key - Cache key
   * @param {Function} factory - Factory function to generate value if not cached
   * @param {number} ttl - Time to live in milliseconds (optional)
   * @returns {Promise<*>} - Cached or generated value
   */
  async getOrSet(key, factory, ttl = null) {
    if (this.has(key)) {
      return this.get(key);
    }

    const value = await factory();
    this.set(key, value, ttl);
    return value;
  }

  /**
   * Clean expired entries
   * @returns {number} - Number of entries removed
   */
  cleanExpired() {
    let removed = 0;
    const now = Date.now();

    for (const [key, expiresAt] of this.ttls.entries()) {
      if (now > expiresAt) {
        this.delete(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get all keys
   * @returns {Array<string>} - All cache keys
   */
  keys() {
    // Clean expired first
    this.cleanExpired();
    return Array.from(this.cache.keys());
  }

  /**
   * Get all values
   * @returns {Array<*>} - All cache values
   */
  values() {
    // Clean expired first
    this.cleanExpired();
    return Array.from(this.cache.values());
  }

  /**
   * Get cache statistics
   * @returns {Object} - Cache stats
   */
  stats() {
    this.cleanExpired();
    return {
      size: this.cache.size,
      keys: this.cache.size,
      withTTL: this.ttls.size
    };
  }
}

// Export singleton instance
module.exports = new CacheAdapter();
