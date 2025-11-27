import path from 'path';
import session from 'express-session';
import config from '../config';
import logger from './logger';

const { directories } = config;

const cacheDir = (directories && directories.cache) || '/cache';
export const dbPath = path.join(cacheDir, 'sessions.db');

const SQLiteStore = require('connect-sqlite3')(session);

const baseStore = new SQLiteStore({
  db: path.basename(dbPath),
  dir: path.dirname(dbPath),
  createDirIfNotExists: true,
});

logger.debug({ dbPath }, 'Initialized shared SQLite session store');

export const localStore = baseStore;

type SessionStoreCallback<T = unknown> = (err: any, data?: T) => void;

interface OidcStore {
  get: (sid: string, cb?: SessionStoreCallback) => void;
  set: (sid: string, sess: session.SessionData, cb?: SessionStoreCallback) => void;
  destroy: (sid: string, cb?: SessionStoreCallback) => void;
}

// OIDC sessions use a thin wrapper around the same store to ensure that
// express-openid-connect's safePromisify treats the methods as callback-based
// and never calls them without a callback argument.
export const oidcStore: OidcStore = {
  get(sid, cb) {
    const callback: SessionStoreCallback = typeof cb === 'function' ? cb : () => {};
    return baseStore.get(sid, callback);
  },
  set(sid, sess, cb) {
    const callback: SessionStoreCallback = typeof cb === 'function' ? cb : () => {};
    return baseStore.set(sid, sess, callback);
  },
  destroy(sid, cb) {
    const callback: SessionStoreCallback = typeof cb === 'function' ? cb : () => {};
    return baseStore.destroy(sid, callback);
  },
};

module.exports = {
  localStore,
  oidcStore,
  dbPath,
};
