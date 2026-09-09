const crypto = require('crypto');

/**
 * Identifiers and timestamps for the records this app stores.
 *
 * Seven services carried a byte-identical copy of generateId and five of
 * nowIso. Nothing had drifted yet, but every copy is a chance for one of them
 * to — and a random-identifier helper is the wrong place to discover that.
 */

/**
 * randomUUID exists on every Node version this app supports; the fallback is
 * kept for the odd runtime that exposes an incomplete crypto module.
 */
const generateId = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`;

const nowIso = () => new Date().toISOString();

module.exports = { generateId, nowIso };
