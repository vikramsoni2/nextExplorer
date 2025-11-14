/**
 * List Users Use Case
 * Get all users (admin only)
 */

class ListUsersUseCase {
  constructor({ usersRepository }) {
    this.usersRepo = usersRepository;
  }

  async execute() {
    const users = await this.usersRepo.findAll();

    // Remove sensitive fields
    return users.map(user => ({
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      roles: user.roles,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    }));
  }
}

module.exports = ListUsersUseCase;
