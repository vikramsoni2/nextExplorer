const path = require('path');
const { directories } = require('../config/index');
const { ForbiddenError } = require('../errors/AppError');

/**
 * Middleware to enforce home directory privacy
 * Prevents users from accessing other users' home directories
 * This applies even to admins for maximum privacy
 */
const enforceHomeDirectoryPrivacy = (req, res, next) => {
  const requestedPath = req.query.path || req.body.path;

  if (!requestedPath) {
    return next();
  }

  const normalizedPath = path.normalize(requestedPath);
  const userHomesRoot = path.normalize(directories.userHomes);

  // Check if the requested path is within the user homes directory
  if (!normalizedPath.startsWith(userHomesRoot)) {
    return next();
  }

  // Get the user ID from the path (first directory after userHomes)
  const relativePath = path.relative(userHomesRoot, normalizedPath);
  const pathParts = relativePath.split(path.sep);
  const targetUserId = pathParts[0];

  // Check if user is trying to access their own home directory
  const currentUserId = req.user?.id;

  if (targetUserId === currentUserId) {
    // User accessing their own home directory - allow
    return next();
  }

  // Trying to access another user's home directory - block
  throw new ForbiddenError('Access to other users\' home directories is not allowed.');
};

module.exports = { enforceHomeDirectoryPrivacy };
