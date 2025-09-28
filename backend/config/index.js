const path = require('path');

const port = Number(process.env.PORT) || 3000;
const appBaseUrl = (process.env.APP_BASE_URL || `http://localhost:${port}`).replace(/\/$/, '');
const volumeDir = path.resolve(process.env.VOLUME_ROOT || '/mnt');
const volumeWithSep = volumeDir.endsWith(path.sep) ? volumeDir : `${volumeDir}${path.sep}`;
const cacheDir = path.resolve(process.env.CACHE_DIR || '/cache');
const thumbnailDir = path.join(cacheDir, 'thumbnails');
const passwordConfigFile = path.join(cacheDir, 'app-config.json');

const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tif', 'tiff', 'avif', 'heic'];
const videoExtensions = ['mp4', 'mov', 'mkv', 'webm', 'm4v', 'avi', 'wmv', 'flv', 'mpg', 'mpeg'];
const excludedFiles = ['thumbs.db', '.DS_Store'];

const mimeTypes = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  avif: 'image/avif',
  heic: 'image/heic',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  m4v: 'video/x-m4v',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
};

const previewableExtensions = new Set([...imageExtensions, ...videoExtensions]);

const corsOptions = {
  origin: '*',
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
};

const authModeEnv = (process.env.AUTH_MODE || '').toLowerCase();
const rawOidcConfig = {
  issuerUrl: process.env.OIDC_ISSUER_URL || null,
  clientId: process.env.OIDC_CLIENT_ID || null,
  clientSecret: process.env.OIDC_CLIENT_SECRET || null,
  redirectUri: process.env.OIDC_REDIRECT_URI || null,
  postLogoutRedirectUri: process.env.OIDC_POST_LOGOUT_REDIRECT_URI || null,
  scope: process.env.OIDC_SCOPE || 'openid profile email',
  prompt: process.env.OIDC_PROMPT || null,
  responseMode: process.env.OIDC_RESPONSE_MODE || null,
  providerName: process.env.OIDC_PROVIDER_NAME || null,
};

let authMode = 'password';
let oidcConfig = {
  enabled: false,
  issuerUrl: null,
  clientId: null,
  clientSecret: null,
  redirectUri: null,
  postLogoutRedirectUri: null,
  scope: null,
  prompt: null,
  responseMode: null,
  providerName: null,
};

const hasOidcConfig = Boolean(
  rawOidcConfig.issuerUrl && rawOidcConfig.clientId && rawOidcConfig.clientSecret,
);

if (hasOidcConfig && (authModeEnv === 'oidc' || !authModeEnv || authModeEnv === 'auto')) {
  authMode = 'oidc';
  oidcConfig = {
    enabled: true,
    issuerUrl: rawOidcConfig.issuerUrl,
    clientId: rawOidcConfig.clientId,
    clientSecret: rawOidcConfig.clientSecret,
    redirectUri: (rawOidcConfig.redirectUri || `${appBaseUrl}/api/auth/oidc/callback`).replace(/\/$/, ''),
    postLogoutRedirectUri: (rawOidcConfig.postLogoutRedirectUri || `${appBaseUrl}/auth/login`).replace(/\/$/, ''),
    scope: rawOidcConfig.scope,
    prompt: rawOidcConfig.prompt,
    responseMode: rawOidcConfig.responseMode,
    providerName: rawOidcConfig.providerName,
  };
} else if (authModeEnv === 'oidc' && !hasOidcConfig) {
  console.warn('AUTH_MODE is set to oidc but required OIDC_* environment variables are missing. Falling back to password mode.');
}

module.exports = {
  port,
  appBaseUrl,
  directories: {
    volume: volumeDir,
    volumeWithSep,
    cache: cacheDir,
    thumbnails: thumbnailDir,
  },
  files: {
    passwordConfig: passwordConfigFile,
  },
  extensions: {
    images: imageExtensions,
    videos: videoExtensions,
    previewable: previewableExtensions,
  },
  excludedFiles,
  mimeTypes,
  corsOptions,
  auth: {
    mode: authMode,
    oidc: oidcConfig,
  },
};
