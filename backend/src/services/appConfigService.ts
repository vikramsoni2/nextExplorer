import { access, readFile, stat, writeFile } from 'fs/promises';

import { directories, files } from '../config';
import { ensureDir } from '../utils/fsUtils';
import { normalizeRelativePath, resolveVolumePath } from '../utils/pathUtils';

const CONFIG_ENCODING: BufferEncoding = 'utf8';
export const DEFAULT_ITERATIONS = 210000;
const CONFIG_FILE_PATH = files.passwordConfig;

export interface AuthConfig {
  passwordHash: string | null;
  salt: string | null;
  iterations: number;
  createdAt: string | null;
}

export interface FavoriteEntry {
  path: string;
  icon: string;
}

export interface AppConfig {
  version: number;
  auth: AuthConfig;
  favorites: FavoriteEntry[];
}

type HttpError = Error & { status?: number; cause?: unknown };

const DEFAULT_CONFIG: AppConfig = {
  version: 2,
  auth: {
    passwordHash: null,
    salt: null,
    iterations: DEFAULT_ITERATIONS,
    createdAt: null,
  },
  favorites: [],
};

let configCache: AppConfig | null = null;
let initialized = false;

const sanitizeAuth = (candidate: Partial<AuthConfig> | undefined): AuthConfig => ({
  passwordHash: typeof candidate?.passwordHash === 'string' ? candidate.passwordHash : null,
  salt: typeof candidate?.salt === 'string' ? candidate.salt : null,
  iterations: Number.isFinite(candidate?.iterations) ? Number(candidate?.iterations) : DEFAULT_ITERATIONS,
  createdAt: typeof candidate?.createdAt === 'string' ? candidate.createdAt : null,
});

const sanitizeFavorite = (candidate: unknown): FavoriteEntry | null => {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const record = candidate as Record<string, unknown>;
  const rawPath = typeof record.path === 'string' ? record.path.trim() : '';
  if (!rawPath) {
    return null;
  }

  let normalizedPath: string;
  try {
    normalizedPath = normalizeRelativePath(rawPath);
  } catch (error) {
    return null;
  }

  if (!normalizedPath) {
    return null;
  }

  const icon = typeof record.icon === 'string' && record.icon.trim()
    ? record.icon.trim()
    : 'solid:StarIcon';

  return {
    path: normalizedPath,
    icon,
  };
};

const sanitizeFavorites = (favorites: unknown): FavoriteEntry[] => {
  if (!Array.isArray(favorites)) {
    return [];
  }

  const seen = new Set<string>();
  const result: FavoriteEntry[] = [];

  favorites.forEach((entry) => {
    const favorite = sanitizeFavorite(entry);
    if (!favorite) return;
    if (seen.has(favorite.path)) return;
    seen.add(favorite.path);
    result.push(favorite);
  });

  return result;
};

const sanitizeConfig = (candidate: unknown): AppConfig => {
  if (!candidate || typeof candidate !== 'object') {
    return { ...DEFAULT_CONFIG, auth: { ...DEFAULT_CONFIG.auth }, favorites: [] };
  }

  const record = candidate as Record<string, unknown> & { auth?: unknown };
  const candidateAuth = record.auth && typeof record.auth === 'object'
    ? sanitizeAuth(record.auth as Partial<AuthConfig>)
    : sanitizeAuth({
      passwordHash: record.passwordHash as string | undefined,
      salt: record.salt as string | undefined,
      iterations: record.iterations as number | undefined,
      createdAt: record.createdAt as string | undefined,
    });

  const favorites = sanitizeFavorites(record.favorites);

  const candidateVersion = Number.isFinite(record.version) ? Number(record.version) : 2;
  const version = candidateVersion >= 2 ? candidateVersion : 2;

  return {
    version,
    auth: candidateAuth,
    favorites,
  };
};

const cloneConfig = (config: AppConfig): AppConfig => ({
  version: config.version,
  auth: { ...config.auth },
  favorites: config.favorites.map((favorite) => ({ ...favorite })),
});

const writeConfig = async (nextConfig: unknown): Promise<AppConfig> => {
  const payload = sanitizeConfig(nextConfig);
  await writeFile(CONFIG_FILE_PATH, `${JSON.stringify(payload, null, 2)}\n`, CONFIG_ENCODING);
  configCache = payload;
  return payload;
};

const readConfig = async (): Promise<AppConfig> => {
  try {
    const raw = await readFile(CONFIG_FILE_PATH, CONFIG_ENCODING);
    if (!raw) {
      return sanitizeConfig(DEFAULT_CONFIG);
    }
    const parsed = JSON.parse(raw) as unknown;
    return sanitizeConfig(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return sanitizeConfig(DEFAULT_CONFIG);
    }
    console.warn('Failed to read app config; defaulting to empty config.', error);
    return sanitizeConfig(DEFAULT_CONFIG);
  }
};

const ensureInitialized = async (): Promise<void> => {
  if (initialized && configCache) {
    return;
  }

  await ensureDir(directories.cache);

  try {
    await access(CONFIG_FILE_PATH);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      await writeConfig(DEFAULT_CONFIG);
    } else {
      throw error;
    }
  }

  configCache = await readConfig();
  initialized = true;
};

export const getConfig = async (): Promise<AppConfig> => {
  await ensureInitialized();
  if (!configCache) {
    throw new Error('Configuration failed to initialize.');
  }
  return configCache;
};

export type ConfigUpdater = ((config: AppConfig) => AppConfig) | Partial<AppConfig>;

export const updateConfig = async (updater: ConfigUpdater): Promise<AppConfig> => {
  await ensureInitialized();
  if (!configCache) {
    throw new Error('Configuration failed to initialize.');
  }

  const current = cloneConfig(configCache);
  const next = typeof updater === 'function'
    ? (updater as (config: AppConfig) => AppConfig)(current)
    : { ...current, ...updater };

  return writeConfig(next);
};

export const getAuthConfig = async (): Promise<AuthConfig> => {
  const config = await getConfig();
  return { ...config.auth };
};

export const setAuthConfig = async (authConfig: Partial<AuthConfig>): Promise<AuthConfig> => {
  const nextAuth = sanitizeAuth(authConfig);
  const updated = await updateConfig((config) => ({
    ...config,
    auth: nextAuth,
  }));
  return { ...updated.auth };
};

const ensureDirectoryExists = async (relativePath: string): Promise<void> => {
  let absolutePath: string;
  try {
    absolutePath = resolveVolumePath(relativePath);
  } catch (error) {
    const invalid = new Error('Path is invalid.') as HttpError;
    invalid.status = 400;
    invalid.cause = error;
    throw invalid;
  }

  try {
    const stats = await stat(absolutePath);
    if (!stats.isDirectory()) {
      const notDir = new Error('Path is not a directory.') as HttpError;
      notDir.status = 400;
      throw notDir;
    }
  } catch (error) {
    const err = error as HttpError & NodeJS.ErrnoException;
    if (err?.code === 'ENOENT') {
      const notFound = new Error('Path not found.') as HttpError;
      notFound.status = 404;
      throw notFound;
    }

    if (typeof err?.status === 'number') {
      throw err;
    }

    throw error;
  }
};

export const getFavorites = async (): Promise<FavoriteEntry[]> => {
  const config = await getConfig();
  return config.favorites.map((favorite) => ({ ...favorite }));
};

const resolveFavoritePath = (rawPath: unknown): string | null => {
  if (typeof rawPath !== 'string') {
    return null;
  }

  const trimmed = rawPath.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return normalizeRelativePath(trimmed);
  } catch (error) {
    const invalid = new Error('Path is invalid.') as HttpError;
    invalid.status = 400;
    invalid.cause = error;
    throw invalid;
  }
};

export const addFavorite = async ({ path, icon }: { path: unknown; icon: unknown }): Promise<FavoriteEntry> => {
  const favorite = sanitizeFavorite({ path, icon });
  if (!favorite) {
    const error = new Error('A valid path is required.') as HttpError;
    error.status = 400;
    throw error;
  }

  await ensureDirectoryExists(favorite.path);

  const updated = await updateConfig((config) => {
    const existingIndex = config.favorites.findIndex((entry) => entry.path === favorite.path);
    const nextFavorites = [...config.favorites];
    if (existingIndex === -1) {
      nextFavorites.push(favorite);
    } else {
      nextFavorites.splice(existingIndex, 1, favorite);
    }
    return {
      ...config,
      favorites: nextFavorites,
    };
  });

  const saved = updated.favorites.find((entry) => entry.path === favorite.path);
  if (!saved) {
    throw new Error('Failed to persist favorite.');
  }
  return { ...saved };
};

export const removeFavorite = async (path: unknown): Promise<FavoriteEntry[]> => {
  const normalizedPath = resolveFavoritePath(path);
  if (!normalizedPath) {
    const error = new Error('A valid path is required.') as HttpError;
    error.status = 400;
    throw error;
  }

  const updated = await updateConfig((config) => ({
    ...config,
    favorites: config.favorites.filter((entry) => entry.path !== normalizedPath),
  }));

  return updated.favorites.map((favorite) => ({ ...favorite }));
};
