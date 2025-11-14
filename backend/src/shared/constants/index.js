/**
 * Constants Index
 * Export all application constants
 */

const fileTypes = require('./file-types');
const mimeTypes = require('./mime-types');
const httpStatus = require('./http-status');
const { PERMISSIONS, ROLES } = require('./permissions');

module.exports = {
  ...fileTypes,
  ...mimeTypes,
  HTTP_STATUS: httpStatus,
  PERMISSIONS,
  ROLES
};
