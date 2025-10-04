import crypto from 'crypto';

import { directories } from '../config';
import { ensureDir } from '../utils/fsUtils';
import { DEFAULT_ITERATIONS, getAuthConfig, setAuthConfig, type AuthConfig } from './appConfigService';

const HASH_ALGORITHM = 'sha512';
const DERIVED_KEY_LENGTH = 64;

type PasswordConfig = AuthConfig;

let passwordConfig: PasswordConfig = {
  passwordHash: null,
  salt: null,
  iterations: DEFAULT_ITERATIONS,
  createdAt: null,
};

const activeTokens = new Set<string>();

const deriveKey = (password: string, salt: string, iterations: number): Promise<string> => new Promise((resolve, reject) => {
  crypto.pbkdf2(password, salt, iterations, DERIVED_KEY_LENGTH, HASH_ALGORITHM, (error, derivedKey) => {
    if (error) {
      reject(error);
      return;
    }
    resolve(derivedKey.toString('hex'));
  });
});

export const initializeAuth = async (): Promise<void> => {
  await ensureDir(directories.cache);
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

export const isPasswordSet = (): boolean => Boolean(passwordConfig.passwordHash && passwordConfig.salt);

export const setPassword = async (password: string): Promise<void> => {
  const salt = crypto.randomBytes(16).toString('hex');
  const iterations = DEFAULT_ITERATIONS;
  const passwordHash = await deriveKey(password, salt, iterations);

  passwordConfig = {
    passwordHash,
    salt,
    iterations,
    createdAt: new Date().toISOString(),
  };

  activeTokens.clear();
  await setAuthConfig(passwordConfig);
};

export const verifyPassword = async (password: string): Promise<boolean> => {
  if (!isPasswordSet() || !passwordConfig.passwordHash || !passwordConfig.salt) {
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

export const createSessionToken = (): string => {
  const token = crypto.randomBytes(32).toString('hex');
  activeTokens.add(token);
  return token;
};

export const isSessionTokenValid = (token: string): boolean => activeTokens.has(token);

export const invalidateSessionToken = (token?: string): void => {
  if (token) {
    activeTokens.delete(token);
  }
};

export const getStatus = (): { requiresSetup: boolean } => ({
  requiresSetup: !isPasswordSet(),
});
