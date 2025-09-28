const express = require('express');

const {
  isPasswordSet,
  setPassword,
  verifyPassword,
  createSessionToken,
  invalidateSessionToken,
  isSessionTokenValid,
  getStatus,
  getSession,
  getAuthMode,
} = require('../services/authService');
const { extractToken } = require('../utils/auth');
const {
  createAuthorizationRequest,
  handleAuthorizationCallback,
  getLogoutUrl,
  getCallbackParams,
} = require('../services/oidcService');

const router = express.Router();

const DEFAULT_REDIRECT_PATH = '/browse/';

const isOidcMode = () => getAuthMode() === 'oidc';

const sanitizeRedirectPath = (candidate, fallback = DEFAULT_REDIRECT_PATH) => {
  if (typeof candidate !== 'string') {
    return fallback;
  }

  const trimmed = candidate.trim();
  if (!trimmed) {
    return fallback;
  }

  if (!trimmed.startsWith('/')) {
    return fallback;
  }

  if (trimmed.startsWith('//')) {
    return fallback;
  }

  return trimmed;
};

router.get('/status', (req, res) => {
  const token = extractToken(req);
  const status = getStatus();
  const session = token ? getSession(token) : null;
  const authenticated = Boolean(session);

  res.json({
    ...status,
    authenticated,
    user: session?.identity || null,
  });
});

router.post('/setup', async (req, res) => {
  if (isOidcMode()) {
    res.status(400).json({ error: 'Password setup is disabled when OpenID Connect is enabled.' });
    return;
  }

  if (isPasswordSet()) {
    res.status(400).json({ error: 'Password has already been configured.' });
    return;
  }

  const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';

  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    return;
  }

  await setPassword(password);
  const token = createSessionToken();

  res.status(201).json({ token });
});

router.post('/login', async (req, res) => {
  if (isOidcMode()) {
    res.status(400).json({ error: 'Password login is disabled when OpenID Connect is enabled.' });
    return;
  }

  if (!isPasswordSet()) {
    res.status(400).json({ error: 'Password setup is required before login.' });
    return;
  }

  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!password) {
    res.status(400).json({ error: 'Password is required.' });
    return;
  }

  const isValid = await verifyPassword(password);

  if (!isValid) {
    res.status(401).json({ error: 'Invalid password.' });
    return;
  }

  const token = createSessionToken();
  res.json({ token });
});

router.post('/logout', (req, res) => {
  const token = extractToken(req);
  const session = token ? getSession(token) : null;
  let logoutUrl = null;

  if (token) {
    invalidateSessionToken(token);
  }

  if (session?.idToken) {
    logoutUrl = getLogoutUrl(session.idToken);
  }

  if (isOidcMode()) {
    res.json({ logoutUrl });
    return;
  }

  res.status(204).end();
});

router.get('/oidc/login', (req, res) => {
  if (!isOidcMode()) {
    res.status(404).json({ error: 'OpenID Connect is not configured.' });
    return;
  }

  try {
    const redirect = sanitizeRedirectPath(req.query?.redirect, DEFAULT_REDIRECT_PATH);
    const { authorizationUrl } = createAuthorizationRequest(redirect);
    res.json({ authorizationUrl });
  } catch (error) {
    console.error('Failed to generate OIDC authorization URL.', error);
    res.status(500).json({ error: 'Unable to initiate authentication.' });
  }
});

router.get('/oidc/callback', async (req, res) => {
  if (!isOidcMode()) {
    res.status(404).json({ error: 'OpenID Connect is not configured.' });
    return;
  }

  try {
    const callbackParams = getCallbackParams(req);
    const { tokenSet, userInfo, redirectPath } = await handleAuthorizationCallback(callbackParams);
    const claims = typeof tokenSet?.claims === 'function' ? tokenSet.claims() : {};

    const identity = {
      sub: claims?.sub || null,
      name: userInfo?.name || claims?.name || null,
      email: userInfo?.email || claims?.email || null,
      preferredUsername: userInfo?.preferred_username || claims?.preferred_username || null,
    };

    Object.keys(identity).forEach((key) => {
      if (identity[key] == null || identity[key] === '') {
        delete identity[key];
      }
    });

    const expiresAt = (() => {
      if (typeof tokenSet?.expires_at === 'number') {
        return Math.floor(tokenSet.expires_at * 1000);
      }
      if (typeof tokenSet?.expires_in === 'number') {
        return Date.now() + Math.floor(tokenSet.expires_in * 1000);
      }
      return null;
    })();

    const sessionToken = createSessionToken({
      identity: Object.keys(identity).length > 0 ? identity : null,
      idToken: tokenSet?.id_token || null,
      accessToken: tokenSet?.access_token || null,
      refreshToken: tokenSet?.refresh_token || null,
      expiresAt,
    });

    const redirectTarget = sanitizeRedirectPath(redirectPath, DEFAULT_REDIRECT_PATH);
    const query = new URLSearchParams({ token: sessionToken, redirect: redirectTarget });
    res.redirect(`/auth/callback?${query.toString()}`);
  } catch (error) {
    console.error('OIDC callback handling failed.', error);
    const message = encodeURIComponent('Authentication failed.');
    res.redirect(`/auth/login?error=${message}`);
  }
});

module.exports = router;
