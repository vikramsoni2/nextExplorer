const { Issuer, generators } = require('openid-client');

const PENDING_STATE_MAX_AGE_MS = 5 * 60 * 1000;

let client = null;
let issuer = null;
let oidcConfig = null;
const pendingAuthorizations = new Map();

const cleanupExpiredStates = () => {
  const now = Date.now();
  for (const [state, entry] of pendingAuthorizations.entries()) {
    if (now - entry.createdAt > PENDING_STATE_MAX_AGE_MS) {
      pendingAuthorizations.delete(state);
    }
  }
};

const ensureInitialized = () => {
  if (!client || !oidcConfig) {
    throw new Error('OIDC client has not been initialized.');
  }
};

const initializeOidc = async (config) => {
  if (!config?.enabled) {
    throw new Error('OIDC cannot be initialized without configuration.');
  }

  oidcConfig = { ...config };
  issuer = await Issuer.discover(config.issuerUrl);

  client = new issuer.Client({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uris: [config.redirectUri],
    response_types: ['code'],
  });
};

const createAuthorizationRequest = (redirectPath = '/') => {
  ensureInitialized();
  cleanupExpiredStates();

  const state = generators.state();
  const nonce = generators.nonce();

  const sanitizedRedirectPath = (() => {
    if (typeof redirectPath !== 'string') {
      return '/';
    }

    const trimmed = redirectPath.trim();
    if (!trimmed) {
      return '/';
    }

    if (!trimmed.startsWith('/')) {
      return '/';
    }

    return trimmed;
  })();

  pendingAuthorizations.set(state, {
    nonce,
    redirectPath: sanitizedRedirectPath,
    createdAt: Date.now(),
  });

  const params = {
    scope: oidcConfig.scope,
    state,
    nonce,
    redirect_uri: oidcConfig.redirectUri,
  };

  if (oidcConfig.prompt) {
    params.prompt = oidcConfig.prompt;
  }

  if (oidcConfig.responseMode) {
    params.response_mode = oidcConfig.responseMode;
  }

  const authorizationUrl = client.authorizationUrl(params);
  return { authorizationUrl, state };
};

const handleAuthorizationCallback = async (callbackParams) => {
  ensureInitialized();
  const state = callbackParams.state;

  if (!state) {
    throw new Error('Missing state parameter in callback.');
  }

  const stateEntry = pendingAuthorizations.get(state);
  pendingAuthorizations.delete(state);

  if (!stateEntry) {
    throw new Error('Invalid or expired authentication state.');
  }

  const checks = { state, nonce: stateEntry.nonce };
  const tokenSet = await client.callback(oidcConfig.redirectUri, callbackParams, checks);

  let userInfo = null;
  try {
    userInfo = await client.userinfo(tokenSet);
  } catch (error) {
    console.warn('OIDC userinfo request failed; continuing with token claims only.', error);
  }

  return {
    tokenSet,
    userInfo,
    redirectPath: stateEntry.redirectPath,
  };
};

const getLogoutUrl = (idToken) => {
  ensureInitialized();
  if (!idToken) {
    return null;
  }

  try {
    return client.endSessionUrl({
      id_token_hint: idToken,
      post_logout_redirect_uri: oidcConfig.postLogoutRedirectUri,
    });
  } catch (error) {
    console.warn('Failed to construct OIDC logout URL; falling back to null.', error);
    return null;
  }
};

const getProviderInfo = () => ({
  issuer: issuer?.metadata?.issuer || null,
  name: oidcConfig?.providerName || issuer?.metadata?.issuer || 'OpenID Connect',
});

const getCallbackParams = (req) => {
  ensureInitialized();
  return client.callbackParams(req);
};

module.exports = {
  initializeOidc,
  createAuthorizationRequest,
  handleAuthorizationCallback,
  getLogoutUrl,
  getProviderInfo,
  getCallbackParams,
};
