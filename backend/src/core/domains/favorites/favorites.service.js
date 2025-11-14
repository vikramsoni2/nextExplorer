/**
 * Favorites Service
 * User favorites/bookmarks management
 */

const { ValidationError } = require('../../../shared/errors');
const logger = require('../../../shared/logger/logger');

class FavoritesService {
  constructor({ jsonStorageAdapter, fileSystemService }) {
    this.storage = jsonStorageAdapter;
    this.fileSystemService = fileSystemService;
    this.favoritesPrefix = 'favorites_';
  }

  /**
   * Get user's favorites
   */
  async getFavorites(userId) {
    const key = `${this.favoritesPrefix}${userId}`;
    const favorites = await this.storage.get(key);
    return favorites || [];
  }

  /**
   * Add favorite
   */
  async addFavorite(userId, path, name) {
    if (!path || typeof path !== 'string') {
      throw new ValidationError('path is required and must be a string');
    }

    if (!name || typeof name !== 'string') {
      throw new ValidationError('name is required and must be a string');
    }

    // Verify path exists
    const exists = await this.fileSystemService.exists(path);
    if (!exists) {
      throw new ValidationError('Path does not exist');
    }

    const favorites = await this.getFavorites(userId);

    // Check if already favorited
    const existingIndex = favorites.findIndex(f => f.path === path);
    if (existingIndex !== -1) {
      throw new ValidationError('Path is already in favorites');
    }

    // Add to favorites
    const favorite = {
      id: this.generateFavoriteId(),
      path,
      name,
      addedAt: new Date().toISOString()
    };

    favorites.push(favorite);

    const key = `${this.favoritesPrefix}${userId}`;
    await this.storage.set(key, favorites);

    logger.info({ userId, path, name }, 'Favorite added');

    return favorite;
  }

  /**
   * Remove favorite
   */
  async removeFavorite(userId, favoriteId) {
    const favorites = await this.getFavorites(userId);

    const index = favorites.findIndex(f => f.id === favoriteId);
    if (index === -1) {
      throw new ValidationError('Favorite not found');
    }

    const removed = favorites.splice(index, 1)[0];

    const key = `${this.favoritesPrefix}${userId}`;
    await this.storage.set(key, favorites);

    logger.info({ userId, favoriteId, path: removed.path }, 'Favorite removed');

    return removed;
  }

  /**
   * Update favorite name
   */
  async updateFavorite(userId, favoriteId, updates) {
    const favorites = await this.getFavorites(userId);

    const index = favorites.findIndex(f => f.id === favoriteId);
    if (index === -1) {
      throw new ValidationError('Favorite not found');
    }

    // Only allow updating the name
    if (updates.name && typeof updates.name === 'string') {
      favorites[index].name = updates.name;
      favorites[index].updatedAt = new Date().toISOString();
    }

    const key = `${this.favoritesPrefix}${userId}`;
    await this.storage.set(key, favorites);

    logger.info({ userId, favoriteId, updates }, 'Favorite updated');

    return favorites[index];
  }

  /**
   * Reorder favorites
   */
  async reorderFavorites(userId, orderedIds) {
    if (!Array.isArray(orderedIds)) {
      throw new ValidationError('orderedIds must be an array');
    }

    const favorites = await this.getFavorites(userId);

    // Create new ordered array
    const ordered = [];
    for (const id of orderedIds) {
      const favorite = favorites.find(f => f.id === id);
      if (favorite) {
        ordered.push(favorite);
      }
    }

    // Add any favorites that weren't in the ordered list
    for (const favorite of favorites) {
      if (!orderedIds.includes(favorite.id)) {
        ordered.push(favorite);
      }
    }

    const key = `${this.favoritesPrefix}${userId}`;
    await this.storage.set(key, ordered);

    logger.info({ userId, count: ordered.length }, 'Favorites reordered');

    return ordered;
  }

  /**
   * Generate unique favorite ID
   */
  generateFavoriteId() {
    return `fav_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = FavoritesService;
