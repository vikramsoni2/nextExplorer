/**
 * Users Controller
 * User management endpoints (admin only)
 */

const { sendSuccess } = require('../../../shared/helpers/response.helper');

class UsersController {
  constructor({
    listUsersUseCase,
    createUserUseCase,
    updateUserUseCase,
    resetUserPasswordUseCase,
    deleteUserUseCase
  }) {
    this.listUsersUseCase = listUsersUseCase;
    this.createUserUseCase = createUserUseCase;
    this.updateUserUseCase = updateUserUseCase;
    this.resetUserPasswordUseCase = resetUserPasswordUseCase;
    this.deleteUserUseCase = deleteUserUseCase;
  }

  /**
   * GET /api/v1/users
   * List all users
   */
  async listUsers(req, res, next) {
    try {
      const users = await this.listUsersUseCase.execute();
      return sendSuccess(res, { users, count: users.length });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/users
   * Create new user
   */
  async createUser(req, res, next) {
    try {
      const { email, username, displayName, password, roles } = req.body;

      const user = await this.createUserUseCase.execute({
        email,
        username,
        displayName,
        password,
        roles
      });

      return sendSuccess(res, { user }, 'User created successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/v1/users/:id
   * Update user
   */
  async updateUser(req, res, next) {
    try {
      const { id } = req.params;
      const { email, username, displayName, roles } = req.body;

      const user = await this.updateUserUseCase.execute({
        userId: id,
        email,
        username,
        displayName,
        roles
      });

      return sendSuccess(res, { user }, 'User updated successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/users/:id/password
   * Reset user password
   */
  async resetPassword(req, res, next) {
    try {
      const { id } = req.params;
      const { newPassword } = req.body;

      await this.resetUserPasswordUseCase.execute({
        userId: id,
        newPassword
      });

      return res.status(204).end();
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/users/:id
   * Delete user
   */
  async deleteUser(req, res, next) {
    try {
      const { id } = req.params;
      const currentUserId = req.session.user.id;

      await this.deleteUserUseCase.execute({
        userId: id,
        currentUserId
      });

      return res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
}

module.exports = UsersController;
