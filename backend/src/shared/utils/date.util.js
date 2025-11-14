/**
 * Date Utility Functions
 * Date manipulation and formatting helpers
 */

/**
 * Get current ISO timestamp
 * @returns {string} - ISO timestamp
 */
const now = () => {
  return new Date().toISOString();
};

/**
 * Add minutes to date
 * @param {Date|string} date - Date to add to
 * @param {number} minutes - Minutes to add
 * @returns {Date} - New date
 */
const addMinutes = (date, minutes) => {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() + minutes);
  return d;
};

/**
 * Check if date is in the past
 * @param {Date|string} date - Date to check
 * @returns {boolean} - True if in past
 */
const isPast = (date) => {
  return new Date(date) < new Date();
};

/**
 * Check if date is in the future
 * @param {Date|string} date - Date to check
 * @returns {boolean} - True if in future
 */
const isFuture = (date) => {
  return new Date(date) > new Date();
};

/**
 * Format date for display
 * @param {Date|string} date - Date to format
 * @param {string} locale - Locale (default: 'en-US')
 * @returns {string} - Formatted date
 */
const formatDate = (date, locale = 'en-US') => {
  return new Date(date).toLocaleDateString(locale);
};

/**
 * Format datetime for display
 * @param {Date|string} date - Date to format
 * @param {string} locale - Locale (default: 'en-US')
 * @returns {string} - Formatted datetime
 */
const formatDateTime = (date, locale = 'en-US') => {
  return new Date(date).toLocaleString(locale);
};

module.exports = {
  now,
  addMinutes,
  isPast,
  isFuture,
  formatDate,
  formatDateTime
};
