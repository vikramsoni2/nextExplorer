/**
 * JSON Storage Adapter
 * File-based storage using JSON files
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('../../shared/logger/logger');

class JsonStorageAdapter {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.cache = {};
  }

  /**
   * Get file path for key
   */
  getFilePath(key) {
    return path.join(this.dataDir, `${key}.json`);
  }

  /**
   * Read JSON file
   */
  async read(filePath) {
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Write JSON file
   */
  async write(filePath, data) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Get data by key
   */
  async get(key) {
    // Check cache
    const cacheKey = `${this.dataDir}:${key}`;
    if (this.cache[cacheKey]) {
      return this.cache[cacheKey];
    }

    // Read from file
    const filePath = this.getFilePath(key);
    const data = await this.read(filePath);

    if (data) {
      this.cache[cacheKey] = data;
    }

    return data;
  }

  /**
   * Set data by key
   */
  async set(key, value) {
    const filePath = this.getFilePath(key);

    // Write to file
    await this.write(filePath, value);

    // Update cache
    const cacheKey = `${this.dataDir}:${key}`;
    this.cache[cacheKey] = value;

    return value;
  }

  /**
   * Update data by key (merge with existing)
   */
  async update(key, updates) {
    const filePath = this.getFilePath(key);

    // Get current data
    let data = await this.read(filePath) || {};

    // Merge updates
    data = { ...data, ...updates };

    // Write to file
    await this.write(filePath, data);

    // Update cache
    const cacheKey = `${this.dataDir}:${key}`;
    this.cache[cacheKey] = data;

    return data;
  }

  /**
   * Delete data by key
   */
  async delete(key) {
    const filePath = this.getFilePath(key);

    // Delete file
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    // Clear cache
    const cacheKey = `${this.dataDir}:${key}`;
    delete this.cache[cacheKey];
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache = {};
  }
}

module.exports = JsonStorageAdapter;
