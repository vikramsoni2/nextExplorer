/**
 * Environment Utility Functions
 * Helper functions for parsing environment variables
 */

/**
 * Normalize boolean values from environment variables
 * @param {string} value - Environment variable value
 * @returns {boolean|null} - Normalized boolean or null if invalid
 */
const normalizeBoolean = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return null;
};

/**
 * Parse byte size strings like "512", "512k", "10M", "1g" into bytes (number)
 * Supports K, M, G, T suffixes (base 1024)
 * @param {string|number} value - Size value
 * @returns {number|null} - Size in bytes or null if invalid
 */
const parseByteSize = (value) => {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value !== 'string') return null;

  const s = value.trim();
  if (!s) return null;

  const m = s.match(/^([0-9]+)\s*([kKmMgGtT]?)b?$/);
  if (!m) return null;

  const num = Number(m[1]);
  if (!Number.isFinite(num)) return null;

  const unit = (m[2] || '').toUpperCase();
  const pow = unit === 'K' ? 1 : unit === 'M' ? 2 : unit === 'G' ? 3 : unit === 'T' ? 4 : 0;
  const factor = 1024 ** pow;

  return Math.max(0, Math.floor(num * factor));
};

/**
 * Parse comma or space-separated scopes
 * @param {string} raw - Raw scope string
 * @returns {string[]|null} - Array of scopes or null if invalid
 */
const parseScopes = (raw) => {
  if (!raw) return null;
  const parts = raw.includes(',') ? raw.split(',') : raw.split(/\s+/);
  return parts.map(s => s.trim()).filter(Boolean);
};

module.exports = {
  normalizeBoolean,
  parseByteSize,
  parseScopes
};
