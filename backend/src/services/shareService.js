const crypto = require('crypto');
const { getDb } = require('./db');
const { normalizeRelativePath } = require('../utils/pathUtils');

const generateId = () => (
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`
);

// Short, human-friendly share IDs for URLs
const SHARE_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const generateShareId = (db) => {
  const alphabet = SHARE_ID_ALPHABET;
  const alphabetLength = alphabet.length;

  const randomCode = (length) => {
    return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabetLength)]).join('');
  };

  // Try short IDs first: 3, then 4, then 5 characters.
  for (let length = 5; length <= 10; length += 1) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = randomCode(length);
      const existing = db.prepare('SELECT 1 FROM shares WHERE id = ?').get(code);
      if (!existing) return code;
    }
  }

  // Fallback: if we somehow cannot find a short unique ID, use a full-length one
  return generateId();
};

/**
 * Normalize and validate a logical path for sharing.
 * Paths are stored in the same normalized "relative" form used elsewhere,
 * e.g. "personal/..." or "some/volume/path".
 */
const normalizeSharePath = (rawPath) => {
  const path = normalizeRelativePath(rawPath || '');
  if (!path) {
    const err = new Error('A non-empty path is required for shares.');
    err.status = 400;
    throw err;
  }
  return path;
};

/**
 * Map a raw DB share row to a client-safe shape.
 */
const toClientShare = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    basePath: row.base_path,
    itemType: row.item_type,
    linkMode: row.link_mode,
    requiresPassword: Boolean(row.link_requires_password),
    linkExpiresAt: row.link_expires_at || null,
    label: row.label || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAccessedAt: row.last_accessed_at || null,
  };
};

/**
 * Create a new share entry.
 *
 * For now this only prepares the data model; callers are expected to
 * ensure that the path exists and that the caller has permission.
 */
const createShare = async ({
  ownerUserId,
  path,
  itemType, // "file" | "directory"
  linkMode = 'ro', // "rw" | "ro"
  label = null,
  linkRequiresPassword = false,
  linkPasswordHash = null,
  linkPasswordSalt = null,
  linkExpiresAt = null,
} = {}) => {
  if (!ownerUserId) {
    const err = new Error('Owner user id is required to create a share.');
    err.status = 400;
    throw err;
  }

  const basePath = normalizeSharePath(path);

  const normalizedItemType = itemType === 'directory' ? 'directory' : 'file';
  const normalizedMode = linkMode === 'rw' ? 'rw' : 'ro';
  const requiresPassword = linkRequiresPassword ? 1 : 0;

  const db = await getDb();
  const id = generateShareId(db);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO shares (
      id,
      owner_user_id,
      base_path,
      item_type,
      link_mode,
      link_requires_password,
      link_password_hash,
      link_password_salt,
      link_expires_at,
      label,
      created_at,
      updated_at,
      last_accessed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(
    id,
    ownerUserId,
    basePath,
    normalizedItemType,
    normalizedMode,
    requiresPassword,
    linkPasswordHash,
    linkPasswordSalt,
    linkExpiresAt,
    label,
    now,
    now,
  );

  return getShareById(id);
};

/**
 * Fetch a single share by id.
 */
const getShareById = async (id) => {
  if (!id) return null;
  const db = await getDb();
  const row = db.prepare(`
    SELECT
      id,
      owner_user_id,
      base_path,
      item_type,
      link_mode,
      link_requires_password,
      link_password_hash,
      link_password_salt,
      link_expires_at,
      label,
      created_at,
      updated_at,
      last_accessed_at
    FROM shares
    WHERE id = ?
  `).get(id);
  return row || null;
};

/**
 * List shares created by a given owner.
 */
const listSharesForOwner = async (ownerUserId) => {
  if (!ownerUserId) {
    const err = new Error('Owner user id is required.');
    err.status = 400;
    throw err;
  }
  const db = await getDb();
  const rows = db.prepare(`
    SELECT
      id,
      owner_user_id,
      base_path,
      item_type,
      link_mode,
      link_requires_password,
      link_password_hash,
      link_password_salt,
      link_expires_at,
      label,
      created_at,
      updated_at,
      last_accessed_at
    FROM shares
    WHERE owner_user_id = ?
    ORDER BY created_at DESC
  `).all(ownerUserId);
  return rows;
};

/**
 * Add or update a per-user entry for a share.
 */
const upsertShareUser = async ({
  shareId,
  userId,
  accessMode = 'ro',
  expiresAt = null,
} = {}) => {
  if (!shareId || !userId) {
    const err = new Error('shareId and userId are required.');
    err.status = 400;
    throw err;
  }

  const mode = accessMode === 'rw' ? 'rw' : 'ro';
  const db = await getDb();
  const now = new Date().toISOString();

  // Ensure a row exists, then update
  let linkRow = db.prepare(`
    SELECT id FROM share_users WHERE share_id = ? AND user_id = ?
  `).get(shareId, userId);

  if (!linkRow) {
    const id = generateId();
    db.prepare(`
      INSERT INTO share_users (
        id,
        share_id,
        user_id,
        access_mode,
        expires_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      shareId,
      userId,
      mode,
      expiresAt,
      now,
      now,
    );
    linkRow = { id };
  } else {
    db.prepare(`
      UPDATE share_users
      SET access_mode = ?,
          expires_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      mode,
      expiresAt,
      now,
      linkRow.id,
    );
  }

  const row = db.prepare(`
    SELECT
      id,
      share_id,
      user_id,
      access_mode,
      expires_at,
      created_at,
      updated_at
    FROM share_users
    WHERE id = ?
  `).get(linkRow.id);

  return row;
};

/**
 * List all per-user access entries for a share.
 */
const listShareUsers = async (shareId) => {
  if (!shareId) {
    const err = new Error('shareId is required.');
    err.status = 400;
    throw err;
  }
  const db = await getDb();
  return db.prepare(`
    SELECT
      id,
      share_id,
      user_id,
      access_mode,
      expires_at,
      created_at,
      updated_at
    FROM share_users
    WHERE share_id = ?
    ORDER BY created_at ASC
  `).all(shareId);
};

/**
 * Remove a per-user access entry for a share.
 */
const deleteShareUser = async (shareId, userId) => {
  if (!shareId || !userId) {
    const err = new Error('shareId and userId are required.');
    err.status = 400;
    throw err;
  }
  const db = await getDb();
  db.prepare('DELETE FROM share_users WHERE share_id = ? AND user_id = ?').run(shareId, userId);
};

/**
 * Delete a share (and cascade its user links).
 */
const deleteShare = async (shareId, ownerUserId) => {
  if (!shareId || !ownerUserId) {
    const err = new Error('shareId and ownerUserId are required.');
    err.status = 400;
    throw err;
  }
  const db = await getDb();
  const result = db.prepare(`
    DELETE FROM shares
    WHERE id = ? AND owner_user_id = ?
  `).run(shareId, ownerUserId);
  return result.changes > 0;
};

/**
 * Map a raw share_users row to client-safe shape.
 */
const toClientShareUser = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    shareId: row.share_id,
    userId: row.user_id,
    accessMode: row.access_mode,
    expiresAt: row.expires_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

/**
 * Find a share whose base_path matches or is a parent of the given relative path.
 * Used for resolving shared items (e.g. thumbnails) in the context of the share owner.
 */
const findShareForPath = async (relativePath) => {
  if (!relativePath) return null;

  const db = await getDb();
  const row = db.prepare(`
    SELECT *
    FROM shares
    WHERE base_path = ?
       OR (? LIKE base_path || '/%')
    ORDER BY LENGTH(base_path) DESC
    LIMIT 1
  `).get(relativePath, relativePath);

  return row || null;
};

/**
 * List shares that are shared with a given user (via share_users).
 */
const listSharesForUser = async (userId) => {
  if (!userId) {
    const err = new Error('userId is required.');
    err.status = 400;
    throw err;
  }

  const db = await getDb();
  const rows = db.prepare(`
    SELECT
      s.id,
      s.owner_user_id,
      s.base_path,
      s.item_type,
      s.link_mode,
      s.link_requires_password,
      s.link_password_hash,
      s.link_password_salt,
      s.link_expires_at,
      s.label,
      s.created_at,
      s.updated_at,
      s.last_accessed_at
    FROM shares s
    INNER JOIN share_users su ON su.share_id = s.id
    WHERE su.user_id = ?
    ORDER BY s.created_at DESC
  `).all(userId);

  return rows.map(toClientShare);
};

module.exports = {
  createShare,
  getShareById,
  listSharesForOwner,
  upsertShareUser,
  listShareUsers,
  deleteShareUser,
  deleteShare,
  listSharesForUser,
  toClientShare,
  toClientShareUser,
  findShareForPath,
};
