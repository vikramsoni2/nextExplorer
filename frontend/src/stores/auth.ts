import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import {
  clearAuthToken,
  fetchAuthStatus,
  login as loginApi,
  logout as logoutApi,
  setAuthToken,
  setupPassword as setupPasswordApi,
  type AuthTokenResponse,
} from '@/api';

const STORAGE_KEY = 'next-explorer-auth-token';

const loadStoredToken = (): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored || null;
};

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(loadStoredToken());
  const requiresSetup = ref(false);
  const isLoading = ref(false);
  const hasStatus = ref(false);
  const lastError = ref<string | null>(null);
  let initPromise: Promise<void> | null = null;

  if (token.value) {
    setAuthToken(token.value);
  }

  const isAuthenticated = computed(() => Boolean(token.value));

  const persistToken = (newToken: string | null): void => {
    token.value = newToken || null;
    if (token.value) {
      setAuthToken(token.value);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, token.value);
      }
    } else {
      clearAuthToken();
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
  };

  const initialize = async (): Promise<void> => {
    if (initPromise) {
      return initPromise;
    }

    initPromise = (async () => {
      isLoading.value = true;
      lastError.value = null;

      try {
        const status = await fetchAuthStatus();
        requiresSetup.value = Boolean(status.requiresSetup);

        if (!requiresSetup.value && token.value) {
          if (!status.authenticated) {
            persistToken(null);
          }
        }
      } catch (error) {
        lastError.value = error instanceof Error ? error.message : 'Failed to load authentication status.';
      } finally {
        hasStatus.value = true;
        isLoading.value = false;
        initPromise = null;
      }
    })();

    return initPromise;
  };

  const setupPassword = async (password: string): Promise<void> => {
    lastError.value = null;
    const response: AuthTokenResponse = await setupPasswordApi(password);
    persistToken(response?.token || null);
    requiresSetup.value = false;
    hasStatus.value = true;
  };

  const login = async (password: string): Promise<void> => {
    lastError.value = null;
    const response: AuthTokenResponse = await loginApi(password);
    persistToken(response?.token || null);
    hasStatus.value = true;
  };

  const logout = async (): Promise<void> => {
    lastError.value = null;
    try {
      await logoutApi();
    } catch (error) {
      // Ignore logout errors so we can still clear the session client-side.
    }
    persistToken(null);
    hasStatus.value = true;
  };

  const clearError = (): void => {
    lastError.value = null;
  };

  return {
    token,
    requiresSetup,
    isLoading,
    hasStatus,
    isAuthenticated,
    lastError,
    initialize,
    ensureStatus: initialize,
    setupPassword,
    login,
    logout,
    clearError,
  };
});
