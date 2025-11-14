/**
 * Search Routes
 * Content and filename search API routes
 */

const express = require('express');
const SearchValidator = require('../validators/search.validator');

/**
 * Create search routes
 */
function createSearchRoutes(searchController, authMiddleware) {
  const router = express.Router();

  // Require authentication
  router.use(authMiddleware);

  // Search by content
  router.post(
    '/content',
    SearchValidator.validateContentSearch,
    searchController.searchContent.bind(searchController)
  );

  // Search by filename
  router.post(
    '/name',
    SearchValidator.validateNameSearch,
    searchController.searchByName.bind(searchController)
  );

  return router;
}

module.exports = createSearchRoutes;
