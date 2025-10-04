import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import {
  addFavorite as addFavoriteRequest,
  fetchFavorites,
  normalizePath,
  removeFavorite as removeFavoriteRequest,
  type FavoriteEntry,
} from '@/api';

export const useFavoritesStore = defineStore('favorites', () => {
  const favorites = ref<FavoriteEntry[]>([]);
  const isLoading = ref(false);
  const hasLoaded = ref(false);
  const lastError = ref<unknown>(null);

  const favoritePaths = computed(() => favorites.value.map((favorite) => favorite.path));
  const favoriteSet = computed(() => new Set(favoritePaths.value));

  const loadFavorites = async (): Promise<void> => {
    if (isLoading.value) return;
    isLoading.value = true;
    lastError.value = null;
    try {
      const response = await fetchFavorites();
      favorites.value = Array.isArray(response) ? response : [];
    } catch (error) {
      lastError.value = error;
      favorites.value = [];
    } finally {
      isLoading.value = false;
      hasLoaded.value = true;
    }
  };

  const ensureLoaded = async (): Promise<void> => {
    if (hasLoaded.value || isLoading.value) {
      return;
    }
    await loadFavorites();
  };

  const isFavorite = (path: string): boolean => {
    const normalizedPath = normalizePath(path || '');
    if (!normalizedPath) {
      return false;
    }
    return favoriteSet.value.has(normalizedPath);
  };

  const addFavorite = async ({ path, icon }: { path: string; icon?: string }): Promise<FavoriteEntry> => {
    const normalizedPath = normalizePath(path || '');
    if (!normalizedPath) {
      throw new Error('A valid path is required to add a favorite.');
    }

    const payload = await addFavoriteRequest(normalizedPath, icon ?? 'solid:StarIcon');
    const favorite: FavoriteEntry = {
      path: payload?.path || normalizedPath,
      icon: payload?.icon || icon || 'solid:StarIcon',
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

  const removeFavorite = async (path: string): Promise<string> => {
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
