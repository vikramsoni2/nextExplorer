/**
 * Users Routes
 * User management API routes (admin only)
 */

const express = require('express');

/**
 * Create users routes
 */
function createUsersRoutes(usersController, authMiddleware, adminMiddleware) {
  const router = express.Router();

  // Require authentication
  router.use(authMiddleware);

  // All routes require admin role
  router.use(adminMiddleware);

  // List users
  router.get('/', usersController.listUsers.bind(usersController));

  // Create user
  router.post('/', usersController.createUser.bind(usersController));

  // Update user
  router.patch('/:id', usersController.updateUser.bind(usersController));

  // Reset user password
  router.post('/:id/password', usersController.resetPassword.bind(usersController));

  // Delete user
  router.delete('/:id', usersController.deleteUser.bind(usersController));

  return router;
}

module.exports = createUsersRoutes;
