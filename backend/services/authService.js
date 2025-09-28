const crypto = require('crypto');

const { directories, auth } = require('../config/index');
const { ensureDir } = require('../utils/fsUtils');
const {
  DEFAULT_ITERATIONS,
  getAuthConfig,
  setAuthConfig,
} = require('./appConfigService');
const oidcService = require('./oidcService');

const HASH_ALGORITHM = 'sha512';
const DERIVED_KEY_LENGTH = 64;
const PASSWORD_SESSION_MODE = 'password';
const OIDC_SESSION_MODE = 'oidc';

const authMode = auth?.mode === OIDC_SESSION_MODE && auth?.oidc?.enabled ? OIDC_SESSION_MODE : PASSWORD_SESSION_MODE;
const oidcEnabled = authMode === OIDC_SESSION_MODE;

let passwordConfig = {
  passwordHash: null,
  salt: null,
  iterations: DEFAULT_ITERATIONS,
  createdAt: null,
};

const activeSessions = new Map();

const deriveKey = (password, salt, iterations) => new Promise((resolve, reject) => {
  crypto.pbkdf2(password, salt, iterations, DERIVED_KEY_LENGTH, HASH_ALGORITHM, (error, derivedKey) => {
    if (error) {
      reject(error);
      return;
    }
    resolve(derivedKey.toString('hex'));
  });
});

const initializeAuth = async () => {
  await ensureDir(directories.cache);

  if (oidcEnabled) {
    activeSessions.clear();
    await oidcService.initializeOidc(auth.oidc);
    passwordConfig = {
      passwordHash: null,
      salt: null,
      iterations: DEFAULT_ITERATIONS,
      createdAt: null,
    };
    return;
  }

  try {
    const authConfig = await getAuthConfig();
    passwordConfig = {
      passwordHash: authConfig.passwordHash || null,
      salt: authConfig.salt || null,
      iterations: authConfig.iterations || DEFAULT_ITERATIONS,
      createdAt: authConfig.createdAt || null,
    };
  } catch (error) {
    console.warn('Failed to load auth configuration; defaulting to setup required.', error);
    passwordConfig = {
      passwordHash: null,
      salt: null,
      iterations: DEFAULT_ITERATIONS,
      createdAt: null,
    };
  }
};

const isPasswordSet = () => {
  if (oidcEnabled) {
    return true;
  }
  return Boolean(passwordConfig.passwordHash && passwordConfig.salt);
};

const setPassword = async (password) => {
  if (oidcEnabled) {
    throw new Error('Password setup is disabled when OIDC mode is enabled.');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const iterations = DEFAULT_ITERATIONS;
  const passwordHash = await deriveKey(password, salt, iterations);

  passwordConfig = {
    passwordHash,
    salt,
    iterations,
    createdAt: new Date().toISOString(),
  };

  activeSessions.clear();
  await setAuthConfig(passwordConfig);
};

const verifyPassword = async (password) => {
  if (oidcEnabled) {
    return false;
  }

  if (!isPasswordSet()) {
    return false;
  }

  const expectedHashHex = passwordConfig.passwordHash;
  const providedHashHex = await deriveKey(password, passwordConfig.salt, passwordConfig.iterations || DEFAULT_ITERATIONS);

  const expected = Buffer.from(expectedHashHex, 'hex');
  const provided = Buffer.from(providedHashHex, 'hex');

  if (expected.length !== provided.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, provided);
};

const createSessionToken = (sessionData = {}) => {
  const token = crypto.randomBytes(32).toString('hex');
  activeSessions.set(token, {
    createdAt: Date.now(),
    mode: oidcEnabled ? OIDC_SESSION_MODE : PASSWORD_SESSION_MODE,
    ...sessionData,
  });
  return token;
};

const getSession = (token) => {
  if (!token) {
    return null;
  }

  const session = activeSessions.get(token);
  if (!session) {
    return null;
  }

  if (session.expiresAt && session.expiresAt <= Date.now()) {
    activeSessions.delete(token);
    return null;
  }

  return session;
};

const isSessionTokenValid = (token) => Boolean(getSession(token));

const invalidateSessionToken = (token) => {
  if (token) {
    activeSessions.delete(token);
  }
};

const getStatus = () => {
  if (oidcEnabled) {
    return {
      requiresSetup: false,
      mode: OIDC_SESSION_MODE,
      oidc: {
        enabled: true,
        provider: oidcService.getProviderInfo(),
        loginPath: '/api/auth/oidc/login',
      },
    };
  }

  return {
    requiresSetup: !isPasswordSet(),
    mode: PASSWORD_SESSION_MODE,
    oidc: {
      enabled: false,
      provider: null,
      loginPath: null,
    },
  };
};

const getAuthMode = () => (oidcEnabled ? OIDC_SESSION_MODE : PASSWORD_SESSION_MODE);

module.exports = {
  initializeAuth,
  isPasswordSet,
  setPassword,
  verifyPassword,
  createSessionToken,
  isSessionTokenValid,
  invalidateSessionToken,
  getStatus,
  getSession,
  getAuthMode,
};
