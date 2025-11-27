import type { Request } from 'express';
import type { Session, SessionData } from 'express-session';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const { getDb } = require('./db');
const { auth: envAuthConfig } = require('../config/index');

type Role = string;

type HttpError = Error & { status?: number; until?: string | null };

export interface ClientUser {
  id: string;
  email: string | null;
  emailVerified: boolean;
  username: string | null;
  displayName: string | null;
  roles: Role[];
  createdAt: string | null;
  updatedAt: string | null;
  authMethods?: { method: string; provider?: string | null }[];
}

interface UserRow {
  id: string;
  email: string;
  email_verified: number | boolean;
  username: string | null;
  display_name: string | null;
  roles: string | null;
  created_at: string;
  updated_at: string;
}

interface AuthMethodRow {
  id: string;
  user_id: string;
  method_type: 'local_password' | 'oidc' | string;
  password_hash?: string | null;
  password_algo?: string | null;
  provider_issuer?: string | null;
  provider_sub?: string | null;
  provider_name?: string | null;
  enabled?: number | boolean;
  last_used_at?: string | null;
  created_at?: string;
}

interface AuthLockRow {
  failed_count: number;
  locked_until: string | null;
}

type RequestWithAuth = Request & {
  user?: Partial<ClientUser> & { id?: string };
  session?: any;
  oidc?: any;
};

const nowIso = (): string => new Date().toISOString();

const toClientUser = (row?: UserRow | null): ClientUser | null => {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    emailVerified: Boolean(row.email_verified),
    username: row.username,
    displayName: row.display_name || null,
    roles: (() => { try { return JSON.parse(row.roles || '[]'); } catch { return []; } })(),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const generateId = (): string => (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`);

const normalizeEmail = (email: unknown): string => (typeof email === 'string' ? email.trim().toLowerCase() : '');

// Lockout policy
const MAX_FAILED_ATTEMPTS = Number(process.env.AUTH_MAX_FAILED || 5);
const LOCKOUT_MINUTES = Number(process.env.AUTH_LOCK_MINUTES || 15);

const getLock = async (key: string): Promise<AuthLockRow> => {
  const db = await getDb();
  return db.prepare('SELECT failed_count, locked_until FROM auth_locks WHERE key = ?').get(key) || { failed_count: 0, locked_until: null };
};

const setLock = async (key: string, failedCount: number, lockedUntil: string | null): Promise<void> => {
  const db = await getDb();
  db.prepare('INSERT INTO auth_locks(key, failed_count, locked_until) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET failed_count = excluded.failed_count, locked_until = excluded.locked_until').run(key, failedCount, lockedUntil);
};

const clearLock = async (key: string): Promise<void> => setLock(key, 0, null);

const isLocked = async (key: string): Promise<boolean> => {
  const row = await getLock(key);
  if (!row.locked_until) return false;
  const until = new Date(row.locked_until).getTime();
  return Number.isFinite(until) && Date.now() < until;
};

const incrementFailedAttempts = async (key: string): Promise<void> => {
  const current = await getLock(key);
  const failed = (Number(current.failed_count) || 0) + 1;
  let lockedUntil: string | null = null;
  if (failed >= MAX_FAILED_ATTEMPTS) {
    lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
  }
  await setLock(key, failed, lockedUntil);
};

const countUsers = async (): Promise<number> => {
  const db = await getDb();
  const row = db.prepare('SELECT COUNT(*) as c FROM users').get();
  return Number(row?.c || 0);
};

// Count users that currently have the admin role
const countAdmins = async (): Promise<number> => {
  const db = await getDb();
  const rows: { roles: string | null }[] = db.prepare('SELECT roles FROM users').all();
  let count = 0;
  for (const r of rows) {
    try {
      const roles = JSON.parse(r.roles || '[]');
      if (Array.isArray(roles) && roles.includes('admin')) count++;
    } catch (_) { /* ignore */ }
  }
  return count;
};

const getById = async (id: string): Promise<ClientUser | null> => {
  const db = await getDb();
  const row: UserRow | undefined = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return toClientUser(row);
};

const getByEmail = async (email: string): Promise<UserRow | null> => {
  const db = await getDb();
  const row: UserRow | undefined = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(email));
  return row || null;
};

// Get auth methods for a user
const getUserAuthMethods = async (userId: string): Promise<AuthMethodRow[]> => {
  const db = await getDb();
  return db.prepare('SELECT * FROM auth_methods WHERE user_id = ? AND enabled = 1').all(userId);
};

// Verify local password for a user
const verifyLocalPassword = async ({ userId, password }: { userId: string; password: string }): Promise<boolean> => {
  const db = await getDb();
  const method: AuthMethodRow = db.prepare(`
    SELECT * FROM auth_methods
    WHERE user_id = ? AND method_type = 'local_password' AND enabled = 1
  `).get(userId);

  if (!method || !method.password_hash) return false;

  const ok = bcrypt.compareSync(password || '', method.password_hash);
  if (ok) {
    // Update last_used_at
    db.prepare('UPDATE auth_methods SET last_used_at = ? WHERE id = ?').run(nowIso(), method.id);
  }
  return ok;
};

// Attempt local login with email + password
const attemptLocalLogin = async ({ email, password }) => {
  const normEmail = normalizeEmail(email);

  // Check lockout
  if (await isLocked(normEmail)) {
    const lock = await getLock(normEmail);
    const until = lock.locked_until || null;
    const err = new Error('Account is temporarily locked due to failed login attempts.') as HttpError;
    err.status = 423;
    err.until = until;
    throw err;
  }

  const db = await getDb();

  // Find user by email
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normEmail);
  if (!user) {
    await incrementFailedAttempts(normEmail);
    return null;
  }

  // Find local password auth method
  const authMethod = db.prepare(`
    SELECT * FROM auth_methods
    WHERE user_id = ? AND method_type = 'local_password' AND enabled = 1
  `).get(user.id);

  if (!authMethod || !authMethod.password_hash) {
    await incrementFailedAttempts(normEmail);
    return null;
  }

  // Verify password
  const valid = bcrypt.compareSync(password || '', authMethod.password_hash);
  if (!valid) {
    await incrementFailedAttempts(normEmail);
    return null;
  }

  // Success - clear lockout
  await clearLock(normEmail);
  db.prepare('UPDATE auth_methods SET last_used_at = ? WHERE id = ?')
    .run(nowIso(), authMethod.id);

  return toClientUser(user);
};

// Create user with local password authentication
const createLocalUser = async ({ email, password, username, displayName, roles = ['user'] }) => {
  const db = await getDb();
  const normEmail = normalizeEmail(email);

  if (!normEmail) {
    const e = new Error('Email is required') as HttpError;
    e.status = 400;
    throw e;
  }

  if (!password || password.length < 6) {
    const e = new Error('Password must be at least 6 characters long') as HttpError;
    e.status = 400;
    throw e;
  }

  // Check if user exists
  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(normEmail);

  if (user) {
    // User exists - check if they already have local password
    const existingAuth = db.prepare(`
      SELECT id FROM auth_methods
      WHERE user_id = ? AND method_type = 'local_password'
    `).get(user.id);

    if (existingAuth) {
      const e = new Error('User already has local password authentication') as HttpError;
      e.status = 409;
      throw e;
    }

    // Auto-link: Add password auth to existing user
    console.log(`[Auth] Adding password auth to existing user: ${user.email}`);

    const hash = bcrypt.hashSync(password, 12);
    const authId = generateId();

    db.prepare(`
      INSERT INTO auth_methods (id, user_id, method_type, password_hash, password_algo, created_at)
      VALUES (?, ?, 'local_password', ?, 'bcrypt', ?)
    `).run(authId, user.id, hash, nowIso());

    user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    return toClientUser(user);
  }

  // New user: Create user and password auth
  const userId = generateId();
  const now = nowIso();
  const rolesJson = JSON.stringify(Array.isArray(roles) ? roles : ['user']);
  const hash = bcrypt.hashSync(password, 12);

  // Create user
  db.prepare(`
    INSERT INTO users (id, email, email_verified, username, display_name, roles, created_at, updated_at)
    VALUES (?, ?, 0, ?, ?, ?, ?, ?)
  `).run(userId, normEmail, username, displayName, rolesJson, now, now);

  // Create password auth method
  const authId = generateId();
  db.prepare(`
    INSERT INTO auth_methods (id, user_id, method_type, password_hash, password_algo, created_at)
    VALUES (?, ?, 'local_password', ?, 'bcrypt', ?)
  `).run(authId, userId, hash, now);

  user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return toClientUser(user);
};

// Change password for user with local password auth
const changeLocalPassword = async ({ userId, currentPassword, newPassword }) => {
  const db = await getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) {
    const e = new Error('User not found.') as HttpError;
    e.status = 404;
    throw e;
  }

  // Check if user has local password auth
  const authMethod = db.prepare(`
    SELECT * FROM auth_methods
    WHERE user_id = ? AND method_type = 'local_password' AND enabled = 1
  `).get(userId);

  if (!authMethod) {
    const e = new Error('Password change is only allowed for users with password authentication.') as HttpError;
    e.status = 400;
    throw e;
  }

  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    const e = new Error('Password must be at least 6 characters long.') as HttpError;
    e.status = 400;
    throw e;
  }

  if (!bcrypt.compareSync(currentPassword || '', authMethod.password_hash)) {
    const e = new Error('Current password is incorrect.') as HttpError;
    e.status = 401;
    throw e;
  }

  const hash = bcrypt.hashSync(newPassword, 12);
  db.prepare('UPDATE auth_methods SET password_hash = ? WHERE id = ?').run(hash, authMethod.id);
  return true;
};

// Admin path: set a local user's password without current password
const setLocalPasswordAdmin = async ({ userId, newPassword }) => {
  const db = await getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) {
    const e = new Error('User not found.') as HttpError;
    e.status = 404;
    throw e;
  }

  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    const e = new Error('Password must be at least 6 characters long.') as HttpError;
    e.status = 400;
    throw e;
  }

  const hash = bcrypt.hashSync(newPassword, 12);

  // Check if user has local password auth
  const authMethod = db.prepare(`
    SELECT id FROM auth_methods
    WHERE user_id = ? AND method_type = 'local_password'
  `).get(userId);

  if (authMethod) {
    // Update existing password
    db.prepare('UPDATE auth_methods SET password_hash = ? WHERE id = ?').run(hash, authMethod.id);
  } else {
    // Create new password auth method
    const authId = generateId();
    db.prepare(`
      INSERT INTO auth_methods (id, user_id, method_type, password_hash, password_algo, created_at)
      VALUES (?, ?, 'local_password', ?, 'bcrypt', ?)
    `).run(authId, userId, hash, nowIso());
  }

  return true;
};

// Add password auth to existing user (for OIDC-only users)
const addLocalPassword = async ({ userId, password }) => {
  const db = await getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) {
    const e = new Error('User not found.') as HttpError;
    e.status = 404;
    throw e;
  }

  // Check if user already has password auth
  const existing = db.prepare(`
    SELECT id FROM auth_methods
    WHERE user_id = ? AND method_type = 'local_password'
  `).get(userId);

  if (existing) {
    const e = new Error('You already have password authentication.') as HttpError;
    e.status = 409;
    throw e;
  }

  if (!password || password.length < 6) {
    const e = new Error('Password must be at least 6 characters long.') as HttpError;
    e.status = 400;
    throw e;
  }

  const hash = bcrypt.hashSync(password, 12);
  const authId = generateId();

  db.prepare(`
    INSERT INTO auth_methods (id, user_id, method_type, password_hash, password_algo, created_at)
    VALUES (?, ?, 'local_password', ?, 'bcrypt', ?)
  `).run(authId, userId, hash, nowIso());

  return true;
};

// Map provider claims/groups to an app roles array
const deriveRolesFromClaims = (claims: Record<string, unknown> = {}, adminGroups: string[] = []) => {
  try {
    const claimGroups = Array.isArray(claims.groups) ? claims.groups.filter((g): g is string => typeof g === 'string') : [];
    const claimRoles = Array.isArray(claims.roles) ? claims.roles.filter((g): g is string => typeof g === 'string') : [];
    const claimEntitlements = Array.isArray(claims.entitlements) ? claims.entitlements.filter((g): g is string => typeof g === 'string') : [];

    const groups = [...claimGroups, ...claimRoles, ...claimEntitlements]
      .filter((g) => typeof g === 'string' && g.trim())
      .map((g) => g.trim().toLowerCase());

    const cfgAdmin = Array.isArray(adminGroups)
      ? adminGroups.map((g) => (typeof g === 'string' ? g.trim().toLowerCase() : '')).filter(Boolean)
      : [];
    const isAdmin = cfgAdmin.some((g) => groups.includes(g));
    return isAdmin ? ['admin'] : ['user'];
  } catch (_) {
    return ['user'];
  }
};

// Get or create user from OIDC claims (with auto-linking via email)
const getOrCreateOidcUser = async ({ issuer, sub, email, emailVerified, username, displayName, roles, requireEmailVerified = false }) => {
  const db = await getDb();
  const normEmail = normalizeEmail(email);

  if (!normEmail) {
    throw new Error('Email is required from OIDC provider');
  }

  // For security, only auto-link if email is verified (when required)
  if (requireEmailVerified && !emailVerified) {
    throw new Error('Email must be verified by identity provider');
  }

  // Check if this OIDC identity already exists
  let authMethod = db.prepare(`
    SELECT * FROM auth_methods
    WHERE provider_issuer = ? AND provider_sub = ? AND method_type = 'oidc'
  `).get(issuer, sub);

  if (authMethod) {
    // Existing OIDC auth - update last used
    db.prepare('UPDATE auth_methods SET last_used_at = ? WHERE id = ?')
      .run(nowIso(), authMethod.id);

    // Update user profile from latest claims
    db.prepare(`
      UPDATE users
      SET display_name = COALESCE(?, display_name),
          username = COALESCE(?, username),
          email_verified = 1,
          updated_at = ?
      WHERE id = ?
    `).run(displayName, username, nowIso(), authMethod.user_id);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(authMethod.user_id);
    return toClientUser(user);
  }

  // New OIDC identity - check if user with this email exists
  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(normEmail);

  if (user) {
    // Auto-link: User exists, add OIDC as new auth method
    console.log(`[Auth] Auto-linking OIDC to existing user: ${user.email}`);

    const authId = generateId();
    db.prepare(`
      INSERT INTO auth_methods (id, user_id, method_type, provider_issuer, provider_sub, provider_name, created_at)
      VALUES (?, ?, 'oidc', ?, ?, ?, ?)
    `).run(authId, user.id, issuer, sub, 'OIDC', nowIso());

    // Update user info from OIDC claims
    db.prepare(`
      UPDATE users
      SET display_name = COALESCE(?, display_name),
          username = COALESCE(?, username),
          email_verified = 1,
          updated_at = ?
      WHERE id = ?
    `).run(displayName, username, nowIso(), user.id);

    user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    return toClientUser(user);
  }

  // New user: Create user and OIDC auth method
  console.log(`[Auth] Creating new user from OIDC: ${normEmail}`);

  const userId = generateId();
  const now = nowIso();
  const rolesJson = JSON.stringify(Array.isArray(roles) ? roles : ['user']);

  // Create user
  db.prepare(`
    INSERT INTO users (id, email, email_verified, username, display_name, roles, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?)
  `).run(userId, normEmail, username, displayName, rolesJson, now, now);

  // Create OIDC auth method
  const authId = generateId();
  db.prepare(`
    INSERT INTO auth_methods (id, user_id, method_type, provider_issuer, provider_sub, provider_name, created_at)
    VALUES (?, ?, 'oidc', ?, ?, ?, ?)
  `).run(authId, userId, issuer, sub, 'OIDC', now);

  user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return toClientUser(user);
};

const getRequestUser = async (req) => {
  // Synthetic or pre-populated user (e.g., AUTH_ENABLED=false)
  if (req?.user && typeof req.user === 'object' && req.user.id) {
    return req.user;
  }

  // Local session
  if (req?.session?.localUserId) {
    const db = await getDb();
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.localUserId);
    return toClientUser(row);
  }

  // OIDC mapped user
  if (req?.oidc && typeof req.oidc.isAuthenticated === 'function' && req.oidc.isAuthenticated() && req.oidc.user?.sub) {
    const issuer = (envAuthConfig && envAuthConfig.oidc && envAuthConfig.oidc.issuer) || null;
    if (!issuer) return null;

    const db = await getDb();
    const authMethod = db.prepare(`
      SELECT user_id FROM auth_methods
      WHERE provider_issuer = ? AND provider_sub = ? AND method_type = 'oidc'
    `).get(issuer, req.oidc.user.sub);

    if (authMethod) {
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(authMethod.user_id);
      return toClientUser(row);
    }

    // Fallback: derive a minimal user object from OIDC claims when DB sync hasn't happened yet
    try {
      const claims = req.oidc.user || {};
      const email = normalizeEmail(claims.email || '');
      const preferredUsername = claims.preferred_username || claims.username || email || claims.sub;
      const displayName = claims.name || preferredUsername || null;
      const roles = deriveRolesFromClaims(claims, envAuthConfig?.oidc?.adminGroups);

      return {
        id: `oidc:${claims.sub}`,
        email,
        emailVerified: claims.email_verified || false,
        username: preferredUsername,
        displayName,
        roles,
        createdAt: null,
        updatedAt: null,
      };
    } catch (_) {
      return null;
    }
  }

  return null;
};

const listUsers = async (): Promise<ClientUser[]> => {
  const db = await getDb();
  const rows = db.prepare('SELECT * FROM users ORDER BY created_at ASC').all();

  const authMethods = db.prepare('SELECT user_id, method_type, provider_name FROM auth_methods WHERE enabled = 1').all();
  const authMap: Record<string, { method: string; provider?: string | null }[]> = {};
  for (const am of authMethods) {
    if (!authMap[am.user_id]) authMap[am.user_id] = [];
    authMap[am.user_id].push({ method: am.method_type, provider: am.provider_name });
  }

  return rows
    .map((r) => {
      const u = toClientUser(r);
      if (!u) return null;
      u.authMethods = authMap[r.id] || [];
      return u;
    })
    .filter((u): u is ClientUser => Boolean(u));
};

const updateUserProfile = async ({ userId, email, username, displayName }): Promise<ClientUser | null> => {
  const db = await getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) {
    const err = new Error('User not found.') as HttpError;
    err.status = 404;
    throw err;
  }

  const updates: string[] = [];
  const values: Array<string | null> = [];

  if (typeof email === 'string') {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      const err = new Error('Email is required.') as HttpError;
      err.status = 400;
      throw err;
    }
    const exists = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(normalizedEmail, userId);
    if (exists) {
      const err = new Error('Email already in use.') as HttpError;
      err.status = 409;
      throw err;
    }
    updates.push('email = ?');
    values.push(normalizedEmail);
  }

  if (typeof username === 'string') {
    const trimmed = username.trim();
    updates.push('username = ?');
    values.push(trimmed || null);
  }

  if (typeof displayName === 'string') {
    const trimmed = displayName.trim();
    updates.push('display_name = ?');
    values.push(trimmed || null);
  }

  if (!updates.length) {
    return toClientUser(user);
  }

  updates.push('updated_at = ?');
  values.push(nowIso());
  values.push(userId);

  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return toClientUser(updated);
};

const updateUserRoles = async ({ userId, roles }): Promise<ClientUser | null> => {
  const db = await getDb();
  const r = Array.isArray(roles) ? roles.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [];
  const json = JSON.stringify(r);
  db.prepare('UPDATE users SET roles = ?, updated_at = ? WHERE id = ?').run(json, nowIso(), userId);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return toClientUser(row);
};

const deleteUser = async ({ userId }) => {
  const db = await getDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!row) {
    return false;
  }

  // Prevent removing the last admin
  try {
    const roles = JSON.parse(row.roles || '[]');
    if (Array.isArray(roles) && roles.includes('admin')) {
      const admins = await countAdmins();
      if (admins <= 1) {
        const e = new Error('Cannot remove the last admin.') as HttpError;
        e.status = 400;
        throw e;
      }
    }
  } catch (e) {
    const err = e as HttpError;
    if (err.status === 400) throw err;
    /* ignore parse errors */
  }

  // Delete user (cascade will delete auth_methods)
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  return true;
};

export {
  countUsers,
  countAdmins,
  getById,
  getByEmail,
  getUserAuthMethods,
  createLocalUser,
  attemptLocalLogin,
  changeLocalPassword,
  setLocalPasswordAdmin,
  addLocalPassword,
  getOrCreateOidcUser,
  getRequestUser,
  listUsers,
  updateUserRoles,
  updateUserProfile,
  deriveRolesFromClaims,
  deleteUser,
};

module.exports = {
  countUsers,
  countAdmins,
  getById,
  getByEmail,
  getUserAuthMethods,
  createLocalUser,
  attemptLocalLogin,
  changeLocalPassword,
  setLocalPasswordAdmin,
  addLocalPassword,
  getOrCreateOidcUser,
  getRequestUser,
  listUsers,
  updateUserRoles,
  updateUserProfile,
  deriveRolesFromClaims,
  deleteUser,

  // Backward compatibility (deprecated)
  countLocalUsers: countUsers,
  getByUsername: getByEmail,
};