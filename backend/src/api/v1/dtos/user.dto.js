/**
 * User DTOs
 * Data transfer objects for user-related responses
 */

class UserDto {
  /**
   * Convert user entity to public DTO (safe for API response)
   */
  static toPublic(user) {
    if (!user) return null;

    return {
      id: user.id,
      email: user.email,
      emailVerified: user.email_verified || user.emailVerified || false,
      username: user.username,
      displayName: user.display_name || user.displayName,
      roles: Array.isArray(user.roles) ? user.roles : (user.roles ? JSON.parse(user.roles) : []),
      createdAt: user.created_at || user.createdAt,
      updatedAt: user.updated_at || user.updatedAt
    };
  }

  /**
   * Convert user to session DTO (minimal info for session)
   */
  static toSession(user) {
    if (!user) return null;

    return {
      id: user.id,
      email: user.email,
      displayName: user.display_name || user.displayName,
      roles: Array.isArray(user.roles) ? user.roles : (user.roles ? JSON.parse(user.roles) : [])
    };
  }

  /**
   * Convert multiple users to public DTOs
   */
  static toList(users) {
    if (!Array.isArray(users)) return [];
    return users.map(user => UserDto.toPublic(user));
  }

  /**
   * Convert user to admin view (includes more details)
   */
  static toAdmin(user) {
    if (!user) return null;

    const publicData = UserDto.toPublic(user);
    return {
      ...publicData,
      authMethods: user.authMethods || []
    };
  }
}

module.exports = UserDto;
