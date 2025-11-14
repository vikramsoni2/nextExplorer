/**
 * DTOs Index
 * Export all data transfer objects
 */

const { BaseResponseDto, SuccessResponseDto, ErrorResponseDto } = require('./response.dto');
const UserDto = require('./user.dto');
const AuthDto = require('./auth.dto');
const FileDto = require('./file.dto');

module.exports = {
  BaseResponseDto,
  SuccessResponseDto,
  ErrorResponseDto,
  UserDto,
  AuthDto,
  FileDto
};
