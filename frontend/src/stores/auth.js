import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import {
  setAuthToken,
  clearAuthToken,
  fetchAuthStatus,
  setupPassword as setupPasswordApi,
  login as loginApi,
  logout as logoutApi,
} from '@/api';

const STORAGE_KEY = 'next-explorer-auth-token';

/**
 * @returns {string | null}
 */
const loadStoredToken = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored || null;
};

export const useAuthStore = defineStore('auth', () => {
  /** @type {import('vue').Ref<string | null>} */
  const token = ref(loadStoredToken());
  /** @type {import('vue').Ref<boolean>} */
  const requiresSetup = ref(false);
  /** @type {import('vue').Ref<boolean>} */
  const authEnabled = ref(true);
  /** @type {import('vue').Ref<boolean>} */
  const isLoading = ref(false);
  /** @type {import('vue').Ref<boolean>} */
  const hasStatus = ref(false);
  /** @type {import('vue').Ref<string | null>} */
  const lastError = ref(null);
  /** @type {Promise<void> | null} */
  let initPromise = null;

  if (token.value) {
    setAuthToken(token.value);
  }

  /**
   * Indicates whether the user is considered authenticated.
   */
  const isAuthenticated = computed(() => {
    return !authEnabled.value || Boolean(token.value);
  });

  /**
   * Persist a fresh auth token both in memory and local storage.
   * @param {string | null} newToken
   */
  const persistToken = (newToken) => {
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

  /**
   * Load authentication status from the backend, caching the in-flight request.
   * @returns {Promise<void>}
   */
  const initialize = async () => {
    if (initPromise) {
      return initPromise;
    }

    initPromise = (async () => {
      isLoading.value = true;
      lastError.value = null;

      try {
        const status = await fetchAuthStatus();
        requiresSetup.value = Boolean(status.requiresSetup);
        authEnabled.value = status?.authEnabled !== false;

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

  /**
   * Complete the initial credentials setup flow.
   * @param {string} password
   * @returns {Promise<void>}
   */
  const setupPassword = async (password) => {
    lastError.value = null;
    const response = await setupPasswordApi(password);
    persistToken(response?.token || null);
    requiresSetup.value = false;
    hasStatus.value = true;
  };

  /**
   * Authenticate an existing user with a password.
   * @param {string} password
   * @returns {Promise<void>}
   */
  const login = async (password) => {
    lastError.value = null;
    const response = await loginApi(password);
    persistToken(response?.token || null);
    hasStatus.value = true;
  };

  /**
   * Sign out the current user and clear stored tokens.
   * @returns {Promise<void>}
   */
  const logout = async () => {
    lastError.value = null;
    try {
      await logoutApi();
    } catch (error) {
      // Ignore logout errors so we can still clear the session client-side.
    }
    persistToken(null);
    hasStatus.value = true;
  };

  /**
   * Remove the current error message.
   */
  const clearError = () => {
    lastError.value = null;
  };

  return {
    token,
    requiresSetup,
    isLoading,
    hasStatus,
    isAuthenticated,
    authEnabled,
    lastError,
    initialize,
    ensureStatus: initialize,
    setupPassword,
    login,
    logout,
    clearError,
  };
});
