const DEFAULT_API_BASE = '/';
export const apiBase = (import.meta.env.VITE_API_URL || DEFAULT_API_BASE).replace(/\/$/, '');

let authToken: string | null = null;

export const setAuthToken = (token: string | null): void => {
  authToken = token ?? null;
};

export const getAuthToken = (): string | null => authToken;

export const clearAuthToken = (): void => {
  authToken = null;
};

export const encodePath = (relativePath = ''): string => {
  if (!relativePath) return '';
  return relativePath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
};

export const normalizePath = (relativePath = ''): string => {
  if (!relativePath) {
    return '';
  }

  const trimmed = relativePath.replace(/^\/+|\/+$/g, '');
  return trimmed;
};

const buildUrl = (endpoint: string): string => `${apiBase}${endpoint}`;

const applyAuthHeader = (headers: Record<string, string> = {}): Record<string, string> => {
  if (!authToken) {
    return headers;
  }

  return {
    ...headers,
    Authorization: `Bearer ${authToken}`,
  };
};

export const appendAuthQuery = (url: string): string => {
  if (!authToken) {
    return url;
  }

  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}token=${encodeURIComponent(authToken)}`;
};

type RequestJsonOptions = RequestInit & { method?: string };

async function requestJson<T = unknown>(endpoint: string, options: RequestJsonOptions = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined ?? {}),
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
      const errorData = await response.json() as { error?: string };
      if (errorData?.error) {
        errorMessage = errorData.error;
      }
    } catch (error) {
      // Ignore JSON parsing errors and fall back to default error message
    }
    throw new Error(errorMessage);
  }

  if (response.status === 204) {
    return null as T;
  }

  return response.json() as Promise<T>;
}

export interface FileItem {
  name: string;
  path: string;
  dateModified: string | number | Date;
  size: number;
  kind: string;
  thumbnail?: string;
}

export interface VolumeEntry {
  name: string;
  path: string;
  kind: string;
}

export interface FavoriteEntry {
  path: string;
  icon: string;
}

export interface TransferItemPayload {
  name: string;
  path: string;
  kind?: string;
}

export interface AuthStatus {
  requiresSetup: boolean;
  authenticated: boolean;
}

export interface AuthTokenResponse {
  token: string;
}

export interface FileContentResponse {
  content: string;
}

export interface ThumbnailResponse {
  thumbnail?: string;
}

export interface CreateFolderResponse {
  success: boolean;
  item?: FileItem;
}

export interface RenameItemResponse {
  success: boolean;
  item?: FileItem;
}

export async function browse(path = ''): Promise<FileItem[]> {
  const normalizedPath = normalizePath(path);
  const encodedPath = encodePath(normalizedPath);
  const endpoint = encodedPath ? `/api/browse/${encodedPath}` : '/api/browse/';
  return requestJson<FileItem[]>(endpoint, { method: 'GET' });
}

export async function getVolumes(): Promise<VolumeEntry[]> {
  return requestJson<VolumeEntry[]>('/api/volumes', { method: 'GET' });
}

export async function copyItems(items: TransferItemPayload[], destination: string): Promise<unknown> {
  return requestJson('/api/files/copy', {
    method: 'POST',
    body: JSON.stringify({ items, destination }),
  });
}

export async function moveItems(items: TransferItemPayload[], destination: string): Promise<unknown> {
  return requestJson('/api/files/move', {
    method: 'POST',
    body: JSON.stringify({ items, destination }),
  });
}

export async function deleteItems(items: TransferItemPayload[]): Promise<unknown> {
  return requestJson('/api/files', {
    method: 'DELETE',
    body: JSON.stringify({ items }),
  });
}

export async function createFolder(destination: string, name?: string): Promise<CreateFolderResponse> {
  const normalizedDestination = normalizePath(destination || '');
  const payload: { path: string; name?: string } = { path: normalizedDestination };

  if (typeof name === 'string') {
    const trimmedName = name.trim();
    if (trimmedName) {
      payload.name = trimmedName;
    }
  }

  return requestJson<CreateFolderResponse>('/api/files/folder', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function renameItem(path: string, name: string, newName: string): Promise<RenameItemResponse> {
  const normalizedPath = normalizePath(path || '');
  return requestJson<RenameItemResponse>('/api/files/rename', {
    method: 'POST',
    body: JSON.stringify({
      path: normalizedPath,
      name,
      newName,
    }),
  });
}

export async function fetchFavorites(): Promise<FavoriteEntry[]> {
  return requestJson<FavoriteEntry[]>('/api/favorites', { method: 'GET' });
}

export async function addFavorite(path: string, icon: string): Promise<FavoriteEntry> {
  const normalizedPath = normalizePath(path || '');
  return requestJson<FavoriteEntry>('/api/favorites', {
    method: 'POST',
    body: JSON.stringify({
      path: normalizedPath,
      icon,
    }),
  });
}

export async function removeFavorite(path: string): Promise<FavoriteEntry[]> {
  const normalizedPath = normalizePath(path || '');
  return requestJson<FavoriteEntry[]>('/api/favorites', {
    method: 'DELETE',
    body: JSON.stringify({
      path: normalizedPath,
    }),
  });
}

export async function fetchFileContent(path: string): Promise<FileContentResponse> {
  return requestJson<FileContentResponse>('/api/editor', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

export async function saveFileContent(path: string, content: string): Promise<unknown> {
  return requestJson('/api/editor', {
    method: 'PUT',
    body: JSON.stringify({ path, content }),
  });
}

export async function fetchThumbnail(relativePath: string): Promise<ThumbnailResponse> {
  const normalizedPath = normalizePath(relativePath);
  if (!normalizedPath) {
    throw new Error('A file path is required to fetch a thumbnail.');
  }

  const encodedPath = encodePath(normalizedPath);
  return requestJson<ThumbnailResponse>(`/api/thumbnails/${encodedPath}`, { method: 'GET' });
}

export const downloadItems = async (paths: string | string[], basePath = ''): Promise<Response> => {
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

export const getPreviewUrl = (relativePath: string): string | null => {
  const normalizedPath = normalizePath(relativePath);
  if (!normalizedPath) {
    return null;
  }

  const params = new URLSearchParams({ path: normalizedPath });
  const url = buildUrl(`/api/preview?${params.toString()}`);
  return appendAuthQuery(url);
};

export const fetchAuthStatus = (): Promise<AuthStatus> => requestJson<AuthStatus>('/api/auth/status', { method: 'GET' });

export const setupPassword = (password: string): Promise<AuthTokenResponse> => requestJson<AuthTokenResponse>('/api/auth/setup', {
  method: 'POST',
  body: JSON.stringify({ password }),
});

export const login = (password: string): Promise<AuthTokenResponse> => requestJson<AuthTokenResponse>('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ password }),
});

export const logout = (): Promise<unknown> => requestJson('/api/auth/logout', {
  method: 'POST',
});
