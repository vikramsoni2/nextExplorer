import {
  requestJson,
  normalizePath,
  encodePath,
  buildUrl,
} from './http';

/**
 * Create a new share for a single file or folder.
 *
 * @param {string} path - Logical path of the item to share.
 * @param {Object} options
 * @param {'ro'|'rw'} [options.mode='ro'] - Link access mode.
 * @param {'file'|'directory'} [options.type] - Item type; if omitted, server infers.
 * @param {string} [options.label] - Optional label for the share.
 * @param {string} [options.password] - Optional password for the link.
 * @param {string} [options.expiresAt] - Optional ISO timestamp (not currently exposed in UI).
 */
export async function createShare(path, {
  mode = 'ro',
  type,
  label,
  password,
  expiresAt,
} = {}) {
  const normalizedPath = normalizePath(path || '');
  if (!normalizedPath) {
    throw new Error('A valid path is required to create a share.');
  }

  const payload = {
    path: normalizedPath,
  };

  if (mode === 'rw' || mode === 'ro') {
    payload.mode = mode;
  }

  if (type === 'file' || type === 'directory') {
    payload.type = type;
  }

  if (typeof label === 'string' && label.trim()) {
    payload.label = label.trim();
  }

  if (typeof password === 'string' && password.length > 0) {
    payload.password = password;
  }

  if (typeof expiresAt === 'string' && expiresAt.trim()) {
    payload.expiresAt = expiresAt.trim();
  }

  return requestJson('/api/shares', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Browse inside a share.
 *
 * @param {string} shareId - Share identifier.
 * @param {string} [innerPath] - Optional inner path within the share.
 */
export async function browseShare(shareId, innerPath = '') {
  if (!shareId) {
    throw new Error('shareId is required to browse a share.');
  }

  const normalizedInner = normalizePath(innerPath || '');
  const encodedInner = encodePath(normalizedInner);

  const base = `/api/share/${encodeURIComponent(shareId)}/browse`;
  const endpoint = encodedInner ? `${base}/${encodedInner}` : `${base}/`;

  return requestJson(endpoint, { method: 'GET' });
}

/**
 * Add or update a per-user share entry.
 *
 * @param {string} shareId
 * @param {string} userId
 * @param {Object} options
 * @param {'ro'|'rw'} [options.accessMode='ro']
 * @param {string} [options.expiresAt]
 */
export async function addShareUser(shareId, userId, {
  accessMode = 'ro',
  expiresAt,
} = {}) {
  if (!shareId || !userId) {
    throw new Error('shareId and userId are required.');
  }

  const payload = {
    userId,
  };

  if (accessMode === 'rw' || accessMode === 'ro') {
    payload.accessMode = accessMode;
  }

  if (typeof expiresAt === 'string' && expiresAt.trim()) {
    payload.expiresAt = expiresAt.trim();
  }

  return requestJson(`/api/shares/${encodeURIComponent(shareId)}/users`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Utility: build an absolute share link URL for a given share id.
 */
export function buildShareLink(shareId) {
  if (!shareId) return '';
  return buildUrl(`/share/${encodeURIComponent(shareId)}/`);
}

/**
 * Utility: build a download URL for a single file within a share.
 *
 * @param {string} shareId
 * @param {string} innerPath - Path relative to the share root (e.g. "foo/bar.txt").
 */
export function buildShareFileDownloadUrl(shareId, innerPath = '') {
  if (!shareId) return '';
  const normalizedInner = normalizePath(innerPath || '');
  const encodedInner = encodePath(normalizedInner);
  const base = `/api/share/${encodeURIComponent(shareId)}/file`;
  return buildUrl(encodedInner ? `${base}/${encodedInner}` : `${base}/`);
}

