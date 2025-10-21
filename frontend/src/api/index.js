/**
 * @typedef {import('@/types').FileItem} FileItem
 */

const DEFAULT_API_BASE = '/';
const apiBase = (import.meta.env.VITE_API_URL || DEFAULT_API_BASE).replace(/\/$/, '');

let authToken = null;

/**
 * Update the stored auth token used by subsequent API requests.
 * @param {string | null | undefined} token
 */
const setAuthToken = (token) => {
  authToken = token || null;
};

/**
 * Returns the currently cached auth token.
 * @returns {string | null}
 */
const getAuthToken = () => authToken;

/**
 * Clears any stored auth token from memory.
 */
const clearAuthToken = () => {
  authToken = null;
};

/**
 * URL-safe encode a file-system style path.
 * @param {string} [relativePath='']
 * @returns {string}
 */
const encodePath = (relativePath = '') => {
  if (!relativePath) return '';
  return relativePath
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
};

/**
 * Normalizes a path by trimming duplicate slashes and leading/trailing separators.
 * @param {string} [relativePath='']
 * @returns {string}
 */
const normalizePath = (relativePath = '') => {
  if (!relativePath) {
    return '';
  }

  const trimmed = relativePath.replace(/^\/+|\/+$/g, '');
  return trimmed;
};

/**
 * Build a fully qualified URL for a backend endpoint.
 * @param {string} endpoint
 * @returns {string}
 */
const buildUrl = (endpoint) => `${apiBase}${endpoint}`;

/**
 * Adds an Authorization header when a token is available.
 * @param {HeadersInit} [headers={}]
 * @returns {HeadersInit}
 */
const applyAuthHeader = (headers = {}) => {
  if (!authToken) {
    return headers;
  }

  return {
    ...headers,
    Authorization: `Bearer ${authToken}`,
  };
};

/**
 * Appends the auth token as a query parameter when set.
 * @param {string} url
 * @returns {string}
 */
const appendAuthQuery = (url) => {
  if (!authToken) {
    return url;
  }

  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}token=${encodeURIComponent(authToken)}`;
};

/**
 * Perform a JSON request to the backend API.
 * @template T
 * @param {string} endpoint
 * @param {RequestInit & { method?: string }} [options={}]
 * @returns {Promise<T>}
 */
const requestJson = async (endpoint, options = {}) => {
  const method = (options.method || 'GET').toUpperCase();
  const headers = {
    ...(options.headers || {}),
  };

  if (method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  const finalHeaders = applyAuthHeader(headers);

  const response = await fetch(buildUrl(endpoint), {
    ...options,
    method,
    headers: finalHeaders,
  });

  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}`;
    try {
      const errorData = await response.json();
      if (errorData?.error) {
        errorMessage = errorData.error;
      }
    } catch (error) {
      // Ignore JSON parsing errors and fall back to default error message
    }
    throw new Error(errorMessage);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
};

/**
 * Browse a directory path and return its entries.
 * @param {string} [path='']
 * @returns {Promise<FileItem[]>}
 */
async function browse(path = '') {
  const normalizedPath = normalizePath(path);
  const encodedPath = encodePath(normalizedPath);
  const endpoint = encodedPath ? `/api/browse/${encodedPath}` : '/api/browse/';
  return requestJson(endpoint, { method: 'GET' });
}

/**
 * Retrieve the list of available volumes or root entries.
 * @returns {Promise<FileItem[]>}
 */
async function getVolumes() {
  return requestJson('/api/volumes', { method: 'GET' });
}

/**
 * Copy a list of items into a destination.
 * @param {Array<Pick<FileItem, 'name' | 'path' | 'kind'>>} items
 * @param {string} destination
 * @returns {Promise<unknown>}
 */
async function copyItems(items, destination) {
  return requestJson('/api/files/copy', {
    method: 'POST',
    body: JSON.stringify({ items, destination }),
  });
}

/**
 * Move a list of items into a destination.
 * @param {Array<Pick<FileItem, 'name' | 'path' | 'kind'>>} items
 * @param {string} destination
 * @returns {Promise<unknown>}
 */
async function moveItems(items, destination) {
  return requestJson('/api/files/move', {
    method: 'POST',
    body: JSON.stringify({ items, destination }),
  });
}

/**
 * Delete a batch of items.
 * @param {Array<Pick<FileItem, 'name' | 'path' | 'kind'>>} items
 * @returns {Promise<unknown>}
 */
async function deleteItems(items) {
  return requestJson('/api/files', {
    method: 'DELETE',
    body: JSON.stringify({ items }),
  });
}

/**
 * Create a folder at the given destination.
 * @param {string} destination
 * @param {string} [name]
 * @returns {Promise<{ item?: FileItem }>}
 */
async function createFolder(destination, name) {
  const normalizedDestination = normalizePath(destination || '');
  const payload = { path: normalizedDestination };

  if (typeof name === 'string' && name.trim()) {
    payload.name = name;
  }

  return requestJson('/api/files/folder', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Rename an existing item inside a directory.
 * @param {string} path
 * @param {string} name
 * @param {string} newName
 * @returns {Promise<{ item?: FileItem }>}
 */
async function renameItem(path, name, newName) {
  const normalizedPath = normalizePath(path || '');
  return requestJson('/api/files/rename', {
    method: 'POST',
    body: JSON.stringify({
      path: normalizedPath,
      name,
      newName,
    }),
  });
}

/**
 * Fetch the current user's favorite locations.
 * @returns {Promise<FileItem[]>}
 */
async function fetchFavorites() {
  return requestJson('/api/favorites', { method: 'GET' });
}

/**
 * Add a directory or file to the favorites list.
 * @param {string} path
 * @param {string} icon
 * @returns {Promise<unknown>}
 */
async function addFavorite(path, icon) {
  const normalizedPath = normalizePath(path || '');
  return requestJson('/api/favorites', {
    method: 'POST',
    body: JSON.stringify({
      path: normalizedPath,
      icon,
    }),
  });
}

/**
 * Remove an item from the favorites list.
 * @param {string} path
 * @returns {Promise<unknown>}
 */
async function removeFavorite(path) {
  const normalizedPath = normalizePath(path || '');
  return requestJson('/api/favorites', {
    method: 'DELETE',
    body: JSON.stringify({
      path: normalizedPath,
    }),
  });
}

/**
 * Request the raw contents of a file for the editor.
 * @param {string} path
 * @returns {Promise<{ content: string }>}
 */
async function fetchFileContent(path) {
  return requestJson('/api/editor', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

/**
 * Persist modified file content back to the server.
 * @param {string} path
 * @param {string} content
 * @returns {Promise<unknown>}
 */
async function saveFileContent(path, content) {
  return requestJson('/api/editor', {
    method: 'PUT',
    body: JSON.stringify({ path, content }),
  });
}

/**
 * Retrieve or generate a thumbnail for a file.
 * @param {string} relativePath
 * @returns {Promise<{ thumbnail: string } | null>}
 */
async function fetchThumbnail(relativePath) {
  const normalizedPath = normalizePath(relativePath);
  if (!normalizedPath) {
    throw new Error('A file path is required to fetch a thumbnail.');
  }

  const encodedPath = encodePath(normalizedPath);
  return requestJson(`/api/thumbnails/${encodedPath}`, { method: 'GET' });
}

const downloadItems = async (paths, basePath = '') => {
  const normalizedList = (Array.isArray(paths) ? paths : [paths])
    .map((item) => normalizePath(item))
    .filter(Boolean);

  if (normalizedList.length === 0) {
    throw new Error('At least one path is required for download.');
  }

  const normalizedBase = normalizePath(basePath || '');

  const response = await fetch(buildUrl('/api/download'), {
    method: 'POST',
    headers: applyAuthHeader({
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({
      items: normalizedList,
      basePath: normalizedBase,
    }),
  });

  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}`;
    try {
      const errorData = await response.json();
      if (errorData?.error) {
        errorMessage = errorData.error;
      }
    } catch (error) {
      // Ignore JSON parsing errors and fall back to default error message
    }
    throw new Error(errorMessage);
  }

  return response;
};

const getPreviewUrl = (relativePath) => {
  const normalizedPath = normalizePath(relativePath);
  if (!normalizedPath) {
    return null;
  }

  const params = new URLSearchParams({ path: normalizedPath });
  const url = buildUrl(`/api/preview?${params.toString()}`);
  return appendAuthQuery(url);
};

const fetchAuthStatus = () => requestJson('/api/auth/status', { method: 'GET' });

const setupPassword = (password) => requestJson('/api/auth/setup', {
  method: 'POST',
  body: JSON.stringify({ password }),
});

const login = (password) => requestJson('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ password }),
});

const logout = () => requestJson('/api/auth/logout', {
  method: 'POST',
});

export {
  apiBase,
  setAuthToken,
  getAuthToken,
  clearAuthToken,
  browse,
  getVolumes,
  copyItems,
  moveItems,
  deleteItems,
  createFolder,
  renameItem,
  fetchFileContent,
  saveFileContent,
  fetchThumbnail,
  fetchFavorites,
  addFavorite,
  removeFavorite,
  downloadItems,
  getPreviewUrl,
  normalizePath,
  encodePath,
  appendAuthQuery,
  fetchAuthStatus,
  // settings
  // GET /api/settings
  // PATCH /api/settings
};

// Settings API (export after function declarations below)
async function getSettings() {
  return requestJson('/api/settings', { method: 'GET' });
}

async function patchSettings(partial) {
  return requestJson('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify(partial || {}),
  });
}

export {
  getSettings,
  patchSettings,
  setupPassword,
  login,
  logout,
};
