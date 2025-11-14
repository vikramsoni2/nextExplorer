/**
 * Crypto Utility Functions
 * Cryptographic operations
 */

const crypto = require('crypto');

/**
 * Generate random ID
 * @returns {string} - Random UUID
 */
const generateId = () => {
  return crypto.randomUUID();
};

/**
 * Generate random token
 * @param {number} bytes - Number of bytes (default: 32)
 * @returns {string} - Random hex token
 */
const generateToken = (bytes = 32) => {
  return crypto.randomBytes(bytes).toString('hex');
};

/**
 * Create hash of data
 * @param {string|Buffer} data - Data to hash
 * @param {string} algorithm - Hash algorithm (default: 'sha256')
 * @returns {string} - Hash in hex format
 */
const createHash = (data, algorithm = 'sha256') => {
  return crypto.createHash(algorithm).update(data).digest('hex');
};

/**
 * Generate CRC32 checksum
 * @param {string|Buffer} data - Data to checksum
 * @returns {string} - CRC32 checksum
 */
const generateCRC32 = (data) => {
  let crc = 0xFFFFFFFF;
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    crc = crc ^ byte;

    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
    }
  }

  return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0');
};

module.exports = {
  generateId,
  generateToken,
  createHash,
  generateCRC32
};
