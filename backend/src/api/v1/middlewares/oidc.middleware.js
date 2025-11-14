/**
 * OIDC Middleware
 * Configures Express OpenID Connect authentication
 */

const crypto = require('crypto');
const { auth: eocAuth } = require('express-openid-connect');
const MemoryStore = require('memorystore')(require('express-session'));
const config = require('../../../shared/config');
const logger = require('../../../shared/logger/logger');
const oidcService = require('../../../core/domains/auth/oidc.service');

/**
 * Derives baseURL from callbackUrl or PUBLIC_URL
 */
function deriveBaseUrl(oidcConfig) {
  try {
    if (oidcConfig.callbackUrl && /^https?:\/\//i.test(oidcConfig.callbackUrl)) {
      const u = new URL(oidcConfig.callbackUrl);
      logger.debug({ baseURL: u.origin, source: 'callbackUrl' }, 'Derived baseURL');
      return u.origin;
    } else if (config.public?.url) {
      const u = new URL(config.public.url);
      logger.debug({ baseURL: u.origin, source: 'PUBLIC_URL' }, 'Derived baseURL');
      return u.origin;
    }
  } catch (err) {
    logger.debug('Failed to derive baseURL');
  }
  return null;
}

/**
 * Determines if OIDC cookies should be secure based on baseURL
 */
function shouldOidcCookieBeSecure(baseURL) {
  try {
    if (baseURL) {
      const u = new URL(baseURL);
      return u.protocol === 'https:';
    }
  } catch (err) {
    // Ignore
  }
  return false;
}

/**
 * Resolves OIDC scopes, ensuring 'openid' is always included
 */
function resolveOidcScopes(oidcConfig) {
  const scopes = Array.isArray(oidcConfig.scopes) && oidcConfig.scopes.length
    ? oidcConfig.scopes
    : ['openid', 'profile', 'email'];

  const scopeParam = Array.from(new Set(['openid', ...scopes])).join(' ');
  logger.debug({ scopes, scopeParam }, 'OIDC scopes resolved');

  return scopeParam;
}

/**
 * Creates the afterCallback handler for user synchronization
 */
function createAfterCallbackHandler(oidcConfig, usersRepository, authMethodsRepository) {
  return async (req, res, session) => {
    logger.debug('afterCallback: start');

    try {
      const persistIssuer = oidcConfig.issuer;
      const accessToken = session?.access_token;

      const hasOidc = Boolean(req?.oidc);
      logger.debug(
        {
          hasOidc,
          accessTokenPresent: Boolean(accessToken),
          persistIssuer
        },
        'OIDC user login state'
      );

      let claims = {};

      // Prefer already-decoded user claims if available on req.oidc.user
      const hasReqUser = Boolean(req?.oidc?.user && req.oidc.user.sub);
      logger.debug({ hasReqUser }, 'afterCallback: req.oidc.user presence');

      if (hasReqUser) {
        claims = req.oidc.user;
        logger.debug('afterCallback: using req.oidc.user');
      }

      // Fetch from userinfo endpoint if access token is available
      if (accessToken && persistIssuer) {
        logger.debug('afterCallback: fetching userinfo via direct HTTP');
        const directClaims = await oidcService.fetchUserInfoClaims({
          issuer: persistIssuer,
          accessToken,
          userInfoURL: oidcConfig.userInfoURL
        });

        if (directClaims && directClaims.sub) {
          claims = directClaims;
          logger.debug('afterCallback: direct userinfo fetch succeeded');
        }
      }

      // Fallback to id_token_claims or session.claims
      if ((!claims || !claims.sub) && session?.id_token_claims) {
        logger.debug('afterCallback: falling back to id_token_claims');
        claims = session.id_token_claims;
      } else if ((!claims || !claims.sub) && session?.claims) {
        logger.debug('afterCallback: falling back to session.claims');
        claims = session.claims;
      }

      const sub = claims && claims.sub ? claims.sub : null;
      if (!sub) {
        logger.debug('afterCallback: no usable claims found; skipping user sync');
        return session;
      }

      // Derive user information from claims
      const email = claims.email || null;
      const emailVerified = claims.email_verified || false;
      const preferredUsername = claims.preferred_username || claims.username || email || sub;
      const displayName = claims.name || preferredUsername || null;
      const roles = oidcService.deriveRolesFromClaims(claims, config.auth.oidc?.adminGroups || []);

      logger.debug(
        {
          sub,
          preferredUsername,
          displayName,
          email,
          emailVerified,
          roles
        },
        'afterCallback: derived user info'
      );

      // Check email verification requirement
      if (config.auth.oidc?.requireEmailVerified && email && !emailVerified) {
        logger.warn({ email }, 'Email verification required but not verified');
        throw new Error('Email verification required');
      }

      // Persist user to database - find or create OIDC user
      let authMethod = await authMethodsRepository.findOidcByIssuerAndSub(persistIssuer, sub);

      if (authMethod) {
        // Update existing user
        const user = await usersRepository.findById(authMethod.userId);
        if (user) {
          // Update user info
          await usersRepository.update(user.id, {
            email: email || user.email,
            emailVerified: emailVerified || user.emailVerified,
            username: preferredUsername || user.username,
            displayName: displayName || user.displayName,
            roles
          });

          // Update auth method last used
          await authMethodsRepository.updateLastUsed(authMethod.id);

          logger.debug({ userId: user.id }, 'OIDC user updated');
        }
      } else {
        // Create new user
        const { generateId } = require('../../../shared/utils/crypto.util');

        const userId = generateId();
        const authMethodId = generateId();

        await usersRepository.create({
          id: userId,
          email: email || `${sub}@oidc.local`,
          emailVerified,
          username: preferredUsername,
          displayName,
          roles
        });

        await authMethodsRepository.create({
          id: authMethodId,
          userId,
          methodType: 'oidc',
          providerIssuer: persistIssuer,
          providerSub: sub,
          providerName: 'oidc',
          enabled: true
        });

        logger.info({ userId, sub }, 'New OIDC user created');
      }

      logger.debug('afterCallback: user persisted/synced');
    } catch (error) {
      logger.warn({ error: error.message }, 'afterCallback user sync failed');
    }

    logger.debug('afterCallback: complete');
    return session;
  };
}

/**
 * Configures Express OpenID Connect (OIDC) authentication
 */
async function configureOidc(app, usersRepository, authMethodsRepository) {
  try {
    logger.debug('Configuring Express OpenID Connect');

    const oidcConfig = config.auth.oidc || {};

    // Resolve configuration
    const scopeParam = resolveOidcScopes(oidcConfig);
    const baseURL = deriveBaseUrl(oidcConfig);
    const sessionSecret = config.auth.session.secret || crypto.randomBytes(32).toString('hex');

    // Check if OIDC should be enabled
    const eocEnabled = Boolean(
      oidcConfig.enabled &&
      oidcConfig.issuer &&
      oidcConfig.clientId &&
      sessionSecret &&
      baseURL
    );

    logger.debug(
      {
        enabled: eocEnabled,
        issuer: !!oidcConfig.issuer,
        clientId: !!oidcConfig.clientId,
        baseURL: !!baseURL
      },
      'EOC enablement check'
    );

    if (!eocEnabled) {
      logger.info(
        'Express OpenID Connect not configured (missing issuer/client/baseURL/secret or disabled)'
      );
      return;
    }

    // Determine cookie security
    const eocCookieSecure = shouldOidcCookieBeSecure(baseURL);
    logger.debug({ eocCookieSecure }, 'OIDC session cookie security');

    // Configure OIDC middleware
    app.use(eocAuth({
      authRequired: false,
      auth0Logout: false,
      idpLogout: false,
      issuerBaseURL: oidcConfig.issuer,
      baseURL,
      clientID: oidcConfig.clientId,
      clientSecret: oidcConfig.clientSecret || undefined,
      secret: sessionSecret,
      authorizationParams: {
        response_type: 'code',
        scope: scopeParam,
      },
      session: {
        store: new MemoryStore({
          checkPeriod: 24 * 60 * 1000,
        }),
        rolling: true,
        cookie: {
          sameSite: 'Lax',
          secure: eocCookieSecure,
          httpOnly: true,
        },
      },
      afterCallback: createAfterCallbackHandler(oidcConfig, usersRepository, authMethodsRepository),
    }));

    logger.info('Express OpenID Connect is configured');
    logger.debug('EOC middleware mounted');
  } catch (error) {
    logger.warn({ error: error.message }, 'Failed to configure Express OpenID Connect');
  }
}

module.exports = { configureOidc };
