/**
 * Auth Use Cases Index
 * Export all auth use cases
 */

const LoginUseCase = require('./login.use-case');
const SetupUseCase = require('./setup.use-case');
const LogoutUseCase = require('./logout.use-case');
const ChangePasswordUseCase = require('./change-password.use-case');

module.exports = {
  LoginUseCase,
  SetupUseCase,
  LogoutUseCase,
  ChangePasswordUseCase
};
