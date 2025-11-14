/**
 * Favorites Routes
 * User favorites/bookmarks API routes
 */

const express = require('express');

/**
 * Create favorites routes
 */
function createFavoritesRoutes(favoritesController, authMiddleware) {
  const router = express.Router();

  // Require authentication
  router.use(authMiddleware);

  // Get all favorites
  router.get('/', favoritesController.getFavorites.bind(favoritesController));

  // Add favorite
  router.post('/', favoritesController.addFavorite.bind(favoritesController));

  // Update favorite
  router.put('/:id', favoritesController.updateFavorite.bind(favoritesController));

  // Remove favorite
  router.delete('/:id', favoritesController.removeFavorite.bind(favoritesController));

  // Reorder favorites
  router.post('/reorder', favoritesController.reorderFavorites.bind(favoritesController));

  return router;
}

module.exports = createFavoritesRoutes;
