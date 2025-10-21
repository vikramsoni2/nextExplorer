import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { normalizePath, fetchFavorites, addFavorite as addFavoriteRequest, removeFavorite as removeFavoriteRequest } from '@/api';

/**
 * @typedef {import('@/types').FavoriteEntry} FavoriteEntry
 */

export const useFavoritesStore = defineStore('favorites', () => {
  /** @type {import('vue').Ref<FavoriteEntry[]>} */
  const favorites = ref([]);
  /** @type {import('vue').Ref<boolean>} */
  const isLoading = ref(false);
  /** @type {import('vue').Ref<boolean>} */
  const hasLoaded = ref(false);
  /** @type {import('vue').Ref<string | Error | null>} */
  const lastError = ref(null);

  const favoritePaths = computed(() => favorites.value.map((favorite) => favorite.path));
  const favoriteSet = computed(() => new Set(favoritePaths.value));

  /**
   * Fetch favorites from the backend.
   * @returns {Promise<void>}
   */
  const loadFavorites = async () => {
    if (isLoading.value) return;
    isLoading.value = true;
    lastError.value = null;
    try {
      const response = await fetchFavorites();
      favorites.value = Array.isArray(response) ? response : [];
    } catch (error) {
      lastError.value = error instanceof Error ? error : new Error('Failed to load favorites.');
      favorites.value = [];
    } finally {
      isLoading.value = false;
      hasLoaded.value = true;
    }
  };

  /**
   * Ensure favorites are loaded at least once.
   * @returns {Promise<void>}
   */
  const ensureLoaded = async () => {
    if (hasLoaded.value || isLoading.value) {
      return;
    }
    await loadFavorites();
  };

  /**
   * Determine if a given path is already a favorite.
   * @param {string} path
   * @returns {boolean}
   */
  const isFavorite = (path) => {
    const normalizedPath = normalizePath(path || '');
    if (!normalizedPath) {
      return false;
    }
    return favoriteSet.value.has(normalizedPath);
  };

  /**
   * Add or update a favorite entry.
   * @param {{ path: string, icon?: string }} payload
   * @returns {Promise<FavoriteEntry>}
   */
  const addFavorite = async ({ path, icon }) => {
    const normalizedPath = normalizePath(path || '');
    if (!normalizedPath) {
      throw new Error('A valid path is required to add a favorite.');
    }

    const response = await addFavoriteRequest(normalizedPath, icon);
    const favorite = {
      path: response?.path || normalizedPath,
      icon: response?.icon || icon || 'solid:StarIcon',
    };

    const currentIndex = favorites.value.findIndex((entry) => entry.path === favorite.path);
    if (currentIndex === -1) {
      favorites.value = [...favorites.value, favorite];
    } else {
      const nextFavorites = [...favorites.value];
      nextFavorites.splice(currentIndex, 1, favorite);
      favorites.value = nextFavorites;
    }

    return favorite;
  };

  /**
   * Remove a favorite entry.
   * @param {string} path
   * @returns {Promise<string>}
   */
  const removeFavorite = async (path) => {
    const normalizedPath = normalizePath(path || '');
    if (!normalizedPath) {
      throw new Error('A valid path is required to remove a favorite.');
    }

    await removeFavoriteRequest(normalizedPath);
    favorites.value = favorites.value.filter((entry) => entry.path !== normalizedPath);

    return normalizedPath;
  };

  return {
    favorites,
    favoritePaths,
    favoriteSet,
    isLoading,
    hasLoaded,
    lastError,
    loadFavorites,
    ensureLoaded,
    isFavorite,
    addFavorite,
    removeFavorite,
  };
});
