/**
 * OIDC Service
 * OpenID Connect integration utilities
 */

const logger = require('../../../shared/logger/logger');

class OidcService {
  /**
   * Fetch user info claims from OIDC userinfo endpoint
   */
  async fetchUserInfoClaims({ issuer, accessToken, userInfoURL }) {
    try {
      // Determine userinfo endpoint
      let endpoint = userInfoURL;

      if (!endpoint && issuer) {
        // Try to construct from issuer
        const baseUrl = issuer.endsWith('/') ? issuer.slice(0, -1) : issuer;
        endpoint = `${baseUrl}/userinfo`;
      }

      if (!endpoint) {
        logger.warn('No userinfo endpoint available');
        return null;
      }

      logger.debug({ endpoint }, 'Fetching OIDC userinfo');

      const response = await fetch(endpoint, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        logger.warn({ status: response.status, endpoint }, 'Userinfo fetch failed');
        return null;
      }

      const claims = await response.json();
      logger.debug({ sub: claims.sub }, 'Userinfo claims fetched');

      return claims;
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to fetch userinfo');
      return null;
    }
  }

  /**
   * Derive user roles from OIDC claims
   */
  deriveRolesFromClaims(claims, adminGroups) {
    const roles = ['user']; // Default role

    if (!adminGroups || adminGroups.length === 0) {
      return roles;
    }

    // Check if user belongs to admin groups
    const userGroups = claims.groups || claims.roles || [];

    if (Array.isArray(userGroups)) {
      const isAdmin = adminGroups.some(adminGroup =>
        userGroups.includes(adminGroup)
      );

      if (isAdmin) {
        roles.push('admin');
      }
    }

    return roles;
  }
}

module.exports = new OidcService();
