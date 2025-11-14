/**
 * File System Utility Functions
 * Promise-based file system operations
 */

const fs = require('fs/promises');

/**
 * Ensure directory exists (create if it doesn't)
 * @param {string} targetPath - Path to directory
 */
const ensureDir = async (targetPath) => {
  await fs.mkdir(targetPath, { recursive: true });
};

/**
 * Check if path exists
 * @param {string} targetPath - Path to check
 * @returns {Promise<boolean>} - True if path exists
 */
const pathExists = async (targetPath) => {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Check if path is a directory
 * @param {string} targetPath - Path to check
 * @returns {Promise<boolean>} - True if directory
 */
const isDirectory = async (targetPath) => {
  try {
    const stats = await fs.stat(targetPath);
    return stats.isDirectory();
  } catch (error) {
    return false;
  }
};

/**
 * Check if path is a file
 * @param {string} targetPath - Path to check
 * @returns {Promise<boolean>} - True if file
 */
const isFile = async (targetPath) => {
  try {
    const stats = await fs.stat(targetPath);
    return stats.isFile();
  } catch (error) {
    return false;
  }
};

module.exports = {
  ensureDir,
  pathExists,
  isDirectory,
  isFile
};
