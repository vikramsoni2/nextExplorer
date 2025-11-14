/**
 * Favorites Controller
 * User favorites/bookmarks endpoints
 */

const { sendSuccess } = require('../../../shared/helpers/response.helper');

class FavoritesController {
  constructor({ favoritesService }) {
    this.favoritesService = favoritesService;
  }

  /**
   * GET /api/v1/favorites
   * Get user's favorites
   */
  async getFavorites(req, res, next) {
    try {
      const userId = req.session.user.id;
      const favorites = await this.favoritesService.getFavorites(userId);
      return sendSuccess(res, { favorites, count: favorites.length });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/favorites
   * Add favorite
   */
  async addFavorite(req, res, next) {
    try {
      const userId = req.session.user.id;
      const { path, name } = req.body;

      const favorite = await this.favoritesService.addFavorite(userId, path, name);
      return sendSuccess(res, favorite, 'Favorite added');
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/favorites/:id
   * Remove favorite
   */
  async removeFavorite(req, res, next) {
    try {
      const userId = req.session.user.id;
      const { id } = req.params;

      await this.favoritesService.removeFavorite(userId, id);
      return sendSuccess(res, null, 'Favorite removed');
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/v1/favorites/:id
   * Update favorite
   */
  async updateFavorite(req, res, next) {
    try {
      const userId = req.session.user.id;
      const { id } = req.params;
      const updates = req.body;

      const favorite = await this.favoritesService.updateFavorite(userId, id, updates);
      return sendSuccess(res, favorite, 'Favorite updated');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/favorites/reorder
   * Reorder favorites
   */
  async reorderFavorites(req, res, next) {
    try {
      const userId = req.session.user.id;
      const { orderedIds } = req.body;

      const favorites = await this.favoritesService.reorderFavorites(userId, orderedIds);
      return sendSuccess(res, { favorites, count: favorites.length }, 'Favorites reordered');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = FavoritesController;
