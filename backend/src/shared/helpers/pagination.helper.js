/**
 * Pagination Helper
 * Utilities for handling paginated data
 */

/**
 * Calculate pagination metadata
 */
function calculatePagination(page, limit, total) {
  const currentPage = Math.max(1, parseInt(page) || 1);
  const itemsPerPage = Math.min(Math.max(1, parseInt(limit) || 20), 100); // Max 100 items per page
  const totalPages = Math.ceil(total / itemsPerPage);
  const offset = (currentPage - 1) * itemsPerPage;

  return {
    page: currentPage,
    limit: itemsPerPage,
    total,
    totalPages,
    offset,
    hasNextPage: currentPage < totalPages,
    hasPrevPage: currentPage > 1
  };
}

/**
 * Extract pagination params from query
 */
function extractPaginationParams(query) {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 20;

  return {
    page: Math.max(1, page),
    limit: Math.min(Math.max(1, limit), 100) // Max 100
  };
}

/**
 * Paginate array
 */
function paginateArray(array, page, limit) {
  const pagination = calculatePagination(page, limit, array.length);
  const startIndex = pagination.offset;
  const endIndex = startIndex + pagination.limit;

  return {
    data: array.slice(startIndex, endIndex),
    pagination
  };
}

module.exports = {
  calculatePagination,
  extractPaginationParams,
  paginateArray
};
