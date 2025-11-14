/**
 * Auth DTOs
 * Data transfer objects for authentication responses
 */

const UserDto = require('./user.dto');

class AuthDto {
  /**
   * Login response
   */
  static loginResponse(user, token = null) {
    return {
      user: UserDto.toSession(user),
      ...(token && { token })
    };
  }

  /**
   * Auth status response
   */
  static statusResponse({ isAuthenticated, user, setupRequired, authModes, strategies }) {
    return {
      isAuthenticated,
      ...(user && { user: UserDto.toSession(user) }),
      setupRequired,
      authModes,
      strategies
    };
  }

  /**
   * Setup response
   */
  static setupResponse(user) {
    return {
      user: UserDto.toPublic(user),
      message: 'Setup completed successfully'
    };
  }
}

module.exports = AuthDto;
