import { normalizeBoolean, parseByteSize } from '../utils/env';

/**
 * Single source of truth for ALL environment variables.
 * Easy to see what env vars the app uses and their defaults.
 */
interface EnvConfig {
  PORT: number;
  VOLUME_ROOT: string;
  CONFIG_DIR: string;
  CACHE_DIR: string;
  PUBLIC_URL: string | null;
  TRUST_PROXY: string | undefined;
  CORS_ORIGINS: string;
  LOG_LEVEL: string | null;
  DEBUG: boolean | null;
  ENABLE_HTTP_LOGGING: boolean;
  AUTH_ENABLED: boolean | null;
  AUTH_MODE: string | null;
  SESSION_SECRET: string | null;
  AUTH_MAX_FAILED: number;
  AUTH_LOCK_MINUTES: number;
  OIDC_ENABLED: boolean | null;
  OIDC_ISSUER: string | null;
  OIDC_AUTHORIZATION_URL: string | null;
  OIDC_TOKEN_URL: string | null;
  OIDC_USERINFO_URL: string | null;
  OIDC_CLIENT_ID: string | null;
  OIDC_CLIENT_SECRET: string | null;
  OIDC_CALLBACK_URL: string | null;
  OIDC_SCOPES: string | null;
  OIDC_ADMIN_GROUPS: string | null;
  OIDC_REQUIRE_EMAIL_VERIFIED: boolean;
  SEARCH_DEEP: boolean | null;
  SEARCH_RIPGREP: boolean | null;
  SEARCH_MAX_FILESIZE: string | null;
  ONLYOFFICE_URL: string | null;
  ONLYOFFICE_SECRET: string | null;
  ONLYOFFICE_LANG: string;
  ONLYOFFICE_FORCE_SAVE: boolean;
  ONLYOFFICE_FILE_EXTENSIONS: string;
  SHOW_VOLUME_USAGE: boolean;
  EDITOR_EXTENSIONS: string;
  FFMPEG_PATH: string | null;
  FFPROBE_PATH: string | null;
  FAVORITES_DEFAULT_ICON: string;
}

const config: EnvConfig = {
  // Server
  PORT: Number(process.env.PORT) || 3000,

  // Paths
  VOLUME_ROOT: process.env.VOLUME_ROOT || '/mnt',
  CONFIG_DIR: process.env.CONFIG_DIR || '/config',
  CACHE_DIR: process.env.CACHE_DIR || '/cache',

  // Public URL & Network
  PUBLIC_URL: process.env.PUBLIC_URL?.trim() || null,
  TRUST_PROXY: process.env.TRUST_PROXY?.trim().toLowerCase(),

  // CORS
  CORS_ORIGINS: process.env.CORS_ORIGIN || process.env.CORS_ORIGINS || process.env.ALLOWED_ORIGINS || '',

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL?.trim().toLowerCase() || null,
  DEBUG: normalizeBoolean(process.env.DEBUG),
  ENABLE_HTTP_LOGGING: normalizeBoolean(process.env.ENABLE_HTTP_LOGGING) || false,

  // Auth
  AUTH_ENABLED: normalizeBoolean(process.env.AUTH_ENABLED),
  AUTH_MODE: process.env.AUTH_MODE?.trim().toLowerCase() || null,
  SESSION_SECRET: process.env.SESSION_SECRET || process.env.AUTH_SESSION_SECRET || null,
  AUTH_MAX_FAILED: Number(process.env.AUTH_MAX_FAILED) || 5,
  AUTH_LOCK_MINUTES: Number(process.env.AUTH_LOCK_MINUTES) || 15,

  // OIDC
  OIDC_ENABLED: normalizeBoolean(process.env.OIDC_ENABLED),
  OIDC_ISSUER: process.env.OIDC_ISSUER || process.env.OIDC_ISSUER_URL || null,
  OIDC_AUTHORIZATION_URL: process.env.OIDC_AUTHORIZATION_URL || null,
  OIDC_TOKEN_URL: process.env.OIDC_TOKEN_URL || null,
  OIDC_USERINFO_URL: process.env.OIDC_USERINFO_URL || null,
  OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID || null,
  OIDC_CLIENT_SECRET: process.env.OIDC_CLIENT_SECRET || null,
  OIDC_CALLBACK_URL: process.env.OIDC_CALLBACK_URL || process.env.OIDC_REDIRECT_URI || null,
  OIDC_SCOPES: process.env.OIDC_SCOPES || process.env.OIDC_SCOPE || null,
  OIDC_ADMIN_GROUPS: process.env.OIDC_ADMIN_GROUPS || process.env.OIDC_ADMIN_GROUP || null,
  OIDC_REQUIRE_EMAIL_VERIFIED: normalizeBoolean(process.env.OIDC_REQUIRE_EMAIL_VERIFIED) || false,

  // Search
  SEARCH_DEEP: normalizeBoolean(process.env.SEARCH_DEEP),
  SEARCH_RIPGREP: normalizeBoolean(process.env.SEARCH_RIPGREP),
  SEARCH_MAX_FILESIZE: process.env.SEARCH_MAX_FILESIZE?.trim() || null,

  // OnlyOffice
  ONLYOFFICE_URL: process.env.ONLYOFFICE_URL?.trim() || null,
  ONLYOFFICE_SECRET: process.env.ONLYOFFICE_SECRET || null,
  ONLYOFFICE_LANG: process.env.ONLYOFFICE_LANG?.trim() || 'en',
  ONLYOFFICE_FORCE_SAVE: normalizeBoolean(process.env.ONLYOFFICE_FORCE_SAVE) || false,
  ONLYOFFICE_FILE_EXTENSIONS: process.env.ONLYOFFICE_FILE_EXTENSIONS || '',

  // Features
  SHOW_VOLUME_USAGE: normalizeBoolean(process.env.SHOW_VOLUME_USAGE) || false,

  // Editor
  EDITOR_EXTENSIONS: process.env.EDITOR_EXTENSIONS || '',

  // FFmpeg
  FFMPEG_PATH: process.env.FFMPEG_PATH || null,
  FFPROBE_PATH: process.env.FFPROBE_PATH || null,

  // Favorites
  FAVORITES_DEFAULT_ICON: process.env.FAVORITES_DEFAULT_ICON || 'outline:StarIcon',
};

export = config;