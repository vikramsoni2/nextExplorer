const path = require('path');
const crypto = require('crypto');
const env = require('./env');
const constants = require('./constants');
const loggingConfig = require('./logging');
const { parseByteSize } = require('../utils/env');

const parseCommaOrSpaceList = (raw) => {
  if (!raw) return [];
  const parts = String(raw).includes(',') ? String(raw).split(',') : String(raw).split(/\s+/);
  return parts.map((s) => s.trim()).filter(Boolean);
};

const DEFAULT_HIDDEN_FILE_PATTERNS = ['.'];

const parseRegexPattern = (token) => {
  if (token.startsWith('regex:')) {
    return { source: token.slice('regex:'.length), flags: '' };
  }

  if (token.startsWith('/')) {
    const lastSlash = token.lastIndexOf('/');
    if (lastSlash > 0) {
      return {
        source: token.slice(1, lastSlash),
        flags: token.slice(lastSlash + 1),
      };
    }
  }

  return null;
};

const escapeRipgrepGlob = (value) => String(value).replace(/[\\*?\[\]{}]/g, '\\$&');

const parseHiddenFilePatterns = (raw) => {
  const tokens = raw == null ? DEFAULT_HIDDEN_FILE_PATTERNS : parseCommaOrSpaceList(raw);
  const prefixes = [];
  const regexes = [];

  for (const token of tokens) {
    const regexPattern = parseRegexPattern(token);
    if (!regexPattern) {
      prefixes.push(token);
      continue;
    }

    try {
      regexes.push(new RegExp(regexPattern.source, regexPattern.flags));
    } catch (err) {
      console.warn(`[Config] Invalid hidden file regex "${token}": ${err.message}`);
    }
  }

  const isHiddenName = (name) => {
    if (!name) return false;
    const baseName = String(name);
    if (prefixes.some((prefix) => prefix && baseName.startsWith(prefix))) return true;

    return regexes.some((regex) => {
      regex.lastIndex = 0;
      return regex.test(baseName);
    });
  };

  const isHiddenPath = (value) =>
    String(value || '')
      .split(/[\\/]+/)
      .filter(Boolean)
      .some(isHiddenName);

  return {
    patterns: tokens,
    prefixes,
    regexes,
    isHiddenName,
    isHiddenPath,
    ripgrepGlobExcludes: prefixes
      .filter((prefix) => prefix && !/[\\/]/.test(prefix))
      .map((prefix) => `!${escapeRipgrepGlob(prefix)}*`),
  };
};

const parseExtensionList = (raw) =>
  String(raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .map((s) => (s.startsWith('.') ? s.slice(1) : s))
    .filter(Boolean);

// Helper: Parse comma/space-separated scopes
const parseScopes = (raw) => {
  const list = parseCommaOrSpaceList(raw);
  return list.length ? list : null;
};

// Native app redirect URIs for the mobile OIDC bridge. Case preserving (schemes
// are case sensitive) and restricted to custom scheme URIs so the bridge can
// never be pointed at an http(s) open redirect. Falls back to a shared default.
const DEFAULT_MOBILE_REDIRECT_URIS = ['nextexplorer://oidc-callback'];
const parseMobileRedirectUris = (raw) => {
  const list = String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((uri) => /^[a-z][a-z0-9+.-]*:\/\//i.test(uri) && !/^https?:\/\//i.test(uri));
  return list.length ? list : DEFAULT_MOBILE_REDIRECT_URIS;
};

// --- Personal folder naming ---
const DEFAULT_USER_FOLDER_NAME_ORDER = ['id', 'username', 'email_local'];
const VALID_USER_FOLDER_NAME_TOKENS = new Set([
  'id',
  'username',
  'email',
  'email_local',
  'displayname',
]);

const parseUserFolderNameOrder = (raw) => {
  const requested = parseCommaOrSpaceList(raw).map((token) => token.toLowerCase());
  const order = [];

  for (const token of requested) {
    if (!VALID_USER_FOLDER_NAME_TOKENS.has(token)) continue;
    if (!order.includes(token)) order.push(token);
  }

  return order.length ? order : DEFAULT_USER_FOLDER_NAME_ORDER;
};

// --- Paths ---
const volumeDir = path.resolve(env.VOLUME_ROOT);
const configDir = path.resolve(env.CONFIG_DIR);
const cacheDir = path.resolve(env.CACHE_DIR);
const userRootDir = env.USER_ROOT ? path.resolve(env.USER_ROOT) : path.join(volumeDir, '_users');

const directories = {
  volume: volumeDir,
  volumeWithSep: volumeDir.endsWith(path.sep) ? volumeDir : `${volumeDir}${path.sep}`,
  config: configDir,
  cache: cacheDir,
  thumbnails: path.join(cacheDir, 'thumbnails'),
  extensions: path.join(configDir, 'extensions'),
  userRoot: userRootDir,
  userRootWithSep: userRootDir.endsWith(path.sep) ? userRootDir : `${userRootDir}${path.sep}`,
};

// --- Public URL ---
let publicUrl = null;
let publicOrigin = null;
if (env.PUBLIC_URL) {
  try {
    const url = new URL(env.PUBLIC_URL);
    publicUrl = url.href.replace(/\/$/, '');
    publicOrigin = url.origin;
  } catch (err) {
    console.warn(`[Config] Invalid PUBLIC_URL: ${env.PUBLIC_URL}`);
  }
}

// --- Additional (internal) origins ---
// Extra origins the app can be reached from (e.g. a LAN IP), comma-separated.
// They are considered valid so accessing the app that way doesn't raise the
// public-URL mismatch warning, and they're accepted by CORS. PUBLIC_URL remains
// the canonical URL used to build absolute links (shares, OIDC callbacks, WOPI).
const parseOriginList = (value) =>
  (typeof value === 'string' ? value.split(',') : [])
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      try {
        return new URL(entry).origin;
      } catch (err) {
        console.warn(`[Config] Invalid INTERNAL_URL entry: ${entry}`);
        return null;
      }
    })
    .filter(Boolean);

const internalOrigins = parseOriginList(env.INTERNAL_URL);
// All origins the frontend should treat as valid (publicOrigin first, deduped).
const knownOrigins = [...new Set([publicOrigin, ...internalOrigins].filter(Boolean))];

// --- CORS ---
const buildCorsConfig = () => {
  if (env.CORS_ORIGINS) {
    if (env.CORS_ORIGINS === '*') return { allowAll: true, origins: [] };
    return {
      allowAll: false,
      origins: env.CORS_ORIGINS.split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    };
  }
  if (knownOrigins.length) return { allowAll: false, origins: [...knownOrigins] };
  return { allowAll: true, origins: [] }; // Backwards compatibility
};

const corsConfig = buildCorsConfig();
const corsOptions = {
  origin: (origin, callback) => {
    if (corsConfig.allowAll || !origin || corsConfig.origins.includes(origin)) {
      callback(null, true);
    } else {
      // Important: do not throw here.
      // - Same-origin requests may still send an Origin header; if PUBLIC_URL is misconfigured,
      //   throwing breaks the whole app for users who access the instance via a different URL.
      // - Returning `false` disables CORS headers for this request (browser will block cross-origin),
      //   while still allowing non-CORS/same-origin clients to function.
      callback(null, false);
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
};

// --- HTTP server timeouts ---
const requestTimeoutMs = (() => {
  const value = env.HTTP_TIMEOUT;
  return Number.isFinite(value) && value >= 0 ? value : 0;
})();

// --- Auth ---
// Determine auth mode: 'local', 'oidc', 'both', or 'disabled'
// If AUTH_MODE is not set, fall back to legacy behavior based on OIDC_ENABLED
const determineAuthMode = () => {
  if (env.AUTH_MODE) {
    const validModes = ['local', 'oidc', 'both', 'disabled'];
    if (!validModes.includes(env.AUTH_MODE)) {
      console.warn(`[Config] Invalid AUTH_MODE="${env.AUTH_MODE}". Using "both" as default.`);
      return 'both';
    }
    return env.AUTH_MODE;
  }
  return 'both';
};

const authMode = determineAuthMode();

const auth = {
  enabled: authMode === 'disabled' ? false : env.AUTH_ENABLED !== false,
  sessionSecret: env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  sessionMaxAgeMs: env.SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000, // Convert days to milliseconds
  mode: authMode,
  oidc: {
    enabled: env.OIDC_ENABLED ?? null,
    issuer: env.OIDC_ISSUER,
    authorizationURL: env.OIDC_AUTHORIZATION_URL,
    tokenURL: env.OIDC_TOKEN_URL,
    userInfoURL: env.OIDC_USERINFO_URL,
    logoutURL: env.OIDC_LOGOUT_URL,
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
    callbackUrl: env.OIDC_CALLBACK_URL || (publicUrl ? `${publicUrl}/callback` : null),
    scopes: parseScopes(env.OIDC_SCOPES) || null,
    adminGroups: parseScopes(env.OIDC_ADMIN_GROUPS) || null,
    requireEmailVerified: env.OIDC_REQUIRE_EMAIL_VERIFIED,
    autoCreateUsers: env.OIDC_AUTO_CREATE_USERS,
    mobileRedirectUris: parseMobileRedirectUris(env.OIDC_MOBILE_REDIRECT_URIS),
  },
};

// --- Search ---
const searchMaxFileSizeBytes = (() => {
  const parsed = parseByteSize(env.SEARCH_MAX_FILESIZE);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5 * 1024 * 1024;
})();

// --- OnlyOffice ---
const onlyoffice = {
  serverUrl: env.ONLYOFFICE_URL?.replace(/\/$/, '') || null,
  secret: env.ONLYOFFICE_SECRET || env.SESSION_SECRET || auth.sessionSecret,
  lang: env.ONLYOFFICE_LANG,
  forceSave: env.ONLYOFFICE_FORCE_SAVE,
  extensions: env.ONLYOFFICE_FILE_EXTENSIONS.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
};

// --- Collabora (WOPI) ---
const collaboraBaseUrl = env.COLLABORA_URL?.replace(/\/$/, '') || null;
const collaboraDiscoveryUrl =
  env.COLLABORA_DISCOVERY_URL?.replace(/\/$/, '') ||
  (collaboraBaseUrl ? `${collaboraBaseUrl}/hosting/discovery` : null);

const collabora = {
  url: collaboraBaseUrl,
  discoveryUrl: collaboraDiscoveryUrl,
  secret: env.COLLABORA_SECRET || null,
  lang: env.COLLABORA_LANG,
  extensions: env.COLLABORA_FILE_EXTENSIONS.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
};

// --- Editor ---
const editorMaxFileSizeBytes = (() => {
  const parsed = parseByteSize(env.EDITOR_MAX_FILESIZE);
  // Default: 2 MiB if not configured or invalid
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2 * 1024 * 1024;
})();

const editor = {
  extensions: parseExtensionList(env.EDITOR_EXTENSIONS),
  maxFileSizeBytes: editorMaxFileSizeBytes,
};

// --- Terminal ---
const terminal = {
  extensions: parseExtensionList(env.TERMINAL_FILE_EXTENSIONS),
};

// --- Favorites ---
const favorites = {
  defaultIcon: env.FAVORITES_DEFAULT_ICON,
};

// --- Personal folders ---
const personal = {
  userFolderNameOrder: parseUserFolderNameOrder(env.USER_FOLDER_NAME_ORDER),
};

// --- Hidden file patterns ---
const hiddenFiles = parseHiddenFilePatterns(env.HIDDEN_FILE_PATTERNS);

// --- Shares ---
const shares = {
  enabled: env.SHARES_ENABLED,
  tokenLength: env.SHARES_TOKEN_LENGTH,
  maxSharesPerUser: env.SHARES_MAX_PER_USER,
  defaultExpiryDays: env.SHARES_DEFAULT_EXPIRY_DAYS,
  guestSessionHours: env.SHARES_GUEST_SESSION_HOURS,
  allowPasswordProtection: env.SHARES_ALLOW_PASSWORD,
  allowAnonymous: env.SHARES_ALLOW_ANONYMOUS,
};

// --- Main Export ---

// --- Archive extraction ---
// Extensions the app is willing to offer for extraction, provided the local
// 7-Zip build actually supports them (checked at runtime by archiveService).
// A whitelist keeps container-ish formats 7-Zip can technically read (docx,
// apk, exe…) from being presented as archives in the UI.
const DEFAULT_ARCHIVE_EXTENSIONS = [
  '7z',
  'zip',
  'iso',
  'rar',
  'tar',
  'gz',
  'tgz',
  'bz2',
  'tbz2',
  'xz',
  'txz',
  'cab',
  'wim',
  'cpio',
  'rpm',
  'deb',
  'z',
  'lzh',
  'arj',
  'zst',
];

const archives = (() => {
  const raw = String(env.ARCHIVE_EXTENSIONS || '').trim();
  // Extraction guards, generous enough for real archives but low enough that a
  // crafted one cannot fill the volume before anyone notices.
  const limits = {
    maxExtractedBytes: (() => {
      const parsed = parseByteSize(env.MAX_EXTRACTED_ARCHIVE_SIZE);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 32 * 1024 * 1024 * 1024;
    })(),
    maxEntries: env.MAX_ARCHIVE_ENTRIES,
  };
  if (!raw) return { extensions: DEFAULT_ARCHIVE_EXTENSIONS, ...limits };
  // 'zip,iso' replaces the default list; '+udf,squashfs' extends it.
  const extend = raw.startsWith('+');
  const list = parseExtensionList(extend ? raw.slice(1) : raw);
  return {
    extensions: extend ? [...new Set([...DEFAULT_ARCHIVE_EXTENSIONS, ...list])] : list,
    ...limits,
  };
})();

// --- Folder size index ---
const VALID_FOLDER_SIZE_MODES = new Set(['off', 'shallow', 'full']);
const folderSizeMode = VALID_FOLDER_SIZE_MODES.has(env.FOLDER_SIZE_MODE)
  ? env.FOLDER_SIZE_MODE
  : 'off';

const folderSize = {
  mode: folderSizeMode,
  enabled: folderSizeMode !== 'off',
  envExcludedPaths: env.FOLDER_SIZE_EXCLUDE_PATHS,
  concurrency: env.FOLDER_SIZE_CONCURRENCY,
  networkConcurrency: env.FOLDER_SIZE_NETWORK_CONCURRENCY,
  flushMs: env.FOLDER_SIZE_FLUSH_MS,
  reconcileMs: env.FOLDER_SIZE_RECONCILE_MS,
  reconcileMinMs: env.FOLDER_SIZE_RECONCILE_MIN_MS,
  reconcileMaxMs: env.FOLDER_SIZE_RECONCILE_MAX_MS,
  reconcileBatch: env.FOLDER_SIZE_RECONCILE_BATCH,
  reconcilePauseMs: env.FOLDER_SIZE_RECONCILE_PAUSE_MS,
  reconcileMaxDirectories:
    Number.isFinite(env.FOLDER_SIZE_RECONCILE_MAX_DIRECTORIES) &&
    env.FOLDER_SIZE_RECONCILE_MAX_DIRECTORIES >= 0
      ? Math.floor(env.FOLDER_SIZE_RECONCILE_MAX_DIRECTORIES)
      : 200,
  subtreeBatch:
    Number.isFinite(env.FOLDER_SIZE_SUBTREE_BATCH) && env.FOLDER_SIZE_SUBTREE_BATCH > 0
      ? Math.floor(env.FOLDER_SIZE_SUBTREE_BATCH)
      : env.FOLDER_SIZE_RECONCILE_BATCH,
  subtreePauseMs:
    Number.isFinite(env.FOLDER_SIZE_SUBTREE_PAUSE_MS) && env.FOLDER_SIZE_SUBTREE_PAUSE_MS >= 0
      ? env.FOLDER_SIZE_SUBTREE_PAUSE_MS
      : env.FOLDER_SIZE_RECONCILE_PAUSE_MS,
  subtreeSlowLogMs: Math.max(0, env.FOLDER_SIZE_SUBTREE_SLOW_LOG_MS),
  ioTimeoutMs:
    Number.isFinite(env.FOLDER_SIZE_IO_TIMEOUT_MS) && env.FOLDER_SIZE_IO_TIMEOUT_MS >= 0
      ? env.FOLDER_SIZE_IO_TIMEOUT_MS
      : 30000,
  maxStalledIo:
    Number.isFinite(env.FOLDER_SIZE_MAX_STALLED_IO) && env.FOLDER_SIZE_MAX_STALLED_IO > 0
      ? Math.floor(env.FOLDER_SIZE_MAX_STALLED_IO)
      : 2,
  rebuild: env.FOLDER_SIZE_REBUILD,
};

module.exports = {
  folderSize,
  archives,
  port: env.PORT,
  address: env.ADDRESS,
  http: {
    requestTimeoutMs,
  },
  directories,

  files: {
    passwordConfig: path.join(configDir, 'app-config.json'),
  },

  public: { url: publicUrl, origin: publicOrigin, origins: knownOrigins },

  extensions: {
    images: constants.IMAGE_EXTENSIONS,
    rawImages: constants.RAW_IMAGE_EXTENSIONS,
    videos: constants.VIDEO_EXTENSIONS,
    audios: constants.AUDIO_EXTENSIONS,
    documents: constants.DOCUMENT_EXTENSIONS,
    previewable: constants.PREVIEWABLE_EXTENSIONS,
  },

  excludedFiles: constants.EXCLUDED_FILES,
  mimeTypes: constants.MIME_TYPES,
  corsOptions,

  auth,

  search: {
    deep: env.SEARCH_DEEP ?? true,
    ripgrep: env.SEARCH_RIPGREP ?? true,
    maxFileSize: env.SEARCH_MAX_FILESIZE,
    maxFileSizeBytes: searchMaxFileSizeBytes,
    // How long one search may spend looking before answering with what it has.
    // Reading a large tree to be certain there is nothing more is worse than
    // an answer that arrives.
    timeoutMs:
      Number.isFinite(env.SEARCH_TIMEOUT_MS) && env.SEARCH_TIMEOUT_MS > 0
        ? env.SEARCH_TIMEOUT_MS
        : 5000,
    index: {
      // Off unless asked for: an index is a promise to keep something up to
      // date, and that is a decision rather than a default.
      enabled: env.SEARCH_INDEX === true,
      // Throw the index away at startup and read everything again. For when
      // the index is suspected rather than trusted: it is derived data, so
      // there is nothing in it that the files themselves do not say.
      rebuild: env.SEARCH_INDEX_REBUILD === true,
      // How many documents share one transaction. Small on purpose: a long
      // transaction is a long stretch of the only thread the server has.
      batch:
        Number.isFinite(env.SEARCH_INDEX_BATCH) && env.SEARCH_INDEX_BATCH > 0
          ? Math.floor(env.SEARCH_INDEX_BATCH)
          : 25,
      // The share of one core a pass may take. This replaces a pause counted
      // per batch, which paced nothing: the cost of a batch is the cost of the
      // files in it, and a fixed pause after an unbounded amount of work is
      // not a limit on anything. A share of time is.
      cpuPercent:
        Number.isFinite(env.SEARCH_INDEX_CPU_PERCENT) &&
        env.SEARCH_INDEX_CPU_PERCENT > 0 &&
        env.SEARCH_INDEX_CPU_PERCENT <= 100
          ? env.SEARCH_INDEX_CPU_PERCENT
          : 25,
      // Folders the index has no business reading. The volume is the user's,
      // and what is worth searching in it is theirs to say: a build tree, a
      // mail spool, a backup of a machine — hundreds of thousands of files
      // each, none of them anything anyone searches for by content.
      //
      // Named rather than guessed at. A list of "obviously noise" directories
      // baked in here would decide, for everyone, that something is not worth
      // finding — and with the index answering in place of the live scan, that
      // decision would be invisible.
      exclude: String(env.SEARCH_INDEX_EXCLUDE || '')
        .split(/[\n,]/)
        .map((entry) => entry.trim().replace(/^\/+|\/+$/g, ''))
        .filter(Boolean),
      // What a pass may add to the process before it gives up and waits for
      // the next one. Every other bound is a belief about what a file costs;
      // this is what holds when one of those beliefs is wrong.
      //
      // Only consulted when the container enforces no limit of its own; where
      // it does, that limit is the ceiling and this is ignored. A pass over
      // two hundred thousand documents was measured growing sixty megabytes,
      // but the figure this is compared against is the whole process, so it
      // has to leave room for everything else that runs during the twenty-odd
      // minutes a pass takes.
      memoryBudgetBytes:
        Number.isFinite(env.SEARCH_INDEX_MEMORY_MB) && env.SEARCH_INDEX_MEMORY_MB > 0
          ? env.SEARCH_INDEX_MEMORY_MB * 1024 * 1024
          : 256 * 1024 * 1024,
      reconcileMs:
        Number.isFinite(env.SEARCH_INDEX_RECONCILE_MS) && env.SEARCH_INDEX_RECONCILE_MS > 0
          ? env.SEARCH_INDEX_RECONCILE_MS
          : 60 * 60 * 1000,
    },
  },

  thumbnails: { size: 200, quality: 70 },
  onlyoffice,
  collabora,
  editor,
  terminal,
  favorites,
  shares,
  hiddenFiles,

  features: {
    volumeUsage: env.SHOW_VOLUME_USAGE,
    folderSizeMode,
    personalFolders: env.USER_DIR_ENABLED,
    userVolumes: env.USER_VOLUMES,
    shares: env.SHARES_ENABLED,
    skipHome: env.SKIP_HOME,
    terminal: env.TERMINAL_ENABLED,
  },

  logging: {
    level: loggingConfig.level,
    isDebug: loggingConfig.isDebug,
    enableHttpLogging: loggingConfig.enableHttpLogging,
  },

  personal,
};
