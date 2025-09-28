import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import {
  setAuthToken,
  clearAuthToken,
  fetchAuthStatus,
  setupPassword as setupPasswordApi,
  login as loginApi,
  logout as logoutApi,
  startOidcLogin as startOidcLoginApi,
} from '@/api';

const STORAGE_KEY = 'next-explorer-auth-token';

const loadStoredToken = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored || null;
};

const sanitizeToken = (token) => {
  if (typeof token !== 'string') {
    return null;
  }

  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed;
};

export const useAuthStore = defineStore('auth', () => {
  const token = ref(sanitizeToken(loadStoredToken()));
  const requiresSetup = ref(false);
  const isLoading = ref(false);
  const hasStatus = ref(false);
  const lastError = ref(null);
  const mode = ref('password');
  const oidc = ref({ enabled: false, provider: null, loginPath: null });
  const user = ref(null);
  let initPromise = null;

  if (token.value) {
    setAuthToken(token.value);
  }

  const isAuthenticated = computed(() => Boolean(token.value));
  const isOidcMode = computed(() => mode.value === 'oidc');

  const persistToken = (newToken) => {
    const sanitized = sanitizeToken(newToken);
    token.value = sanitized;

    if (sanitized) {
      setAuthToken(sanitized);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, sanitized);
      }
    } else {
      clearAuthToken();
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
  };

  const persistStatus = (status) => {
    mode.value = status?.mode || 'password';
    oidc.value = status?.oidc || { enabled: false, provider: null, loginPath: null };
    requiresSetup.value = Boolean(status?.requiresSetup && mode.value !== 'oidc');
    user.value = status?.user || null;
  };

  const initialize = async () => {
    if (initPromise) {
      return initPromise;
    }

    initPromise = (async () => {
      isLoading.value = true;
      lastError.value = null;

      try {
        const status = await fetchAuthStatus();
        persistStatus(status);

        if (!status?.authenticated && token.value) {
          persistToken(null);
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

  const setupPassword = async (password) => {
    lastError.value = null;
    const response = await setupPasswordApi(password);
    persistToken(response?.token || null);
    requiresSetup.value = false;
    hasStatus.value = true;
  };

  const login = async (password) => {
    lastError.value = null;
    const response = await loginApi(password);
    persistToken(response?.token || null);
    hasStatus.value = true;
  };

  const beginOidcLogin = async (redirectPath) => {
    lastError.value = null;
    try {
      const response = await startOidcLoginApi(redirectPath);
      const targetUrl = response?.authorizationUrl;
      if (typeof targetUrl !== 'string' || !targetUrl) {
        throw new Error('Missing authorization URL from server.');
      }
      window.location.href = targetUrl;
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : 'Failed to start OpenID Connect login.';
      throw error;
    }
  };

  const logout = async () => {
    lastError.value = null;
    let redirectUrl = null;

    try {
      const response = await logoutApi();
      if (response && typeof response.logoutUrl === 'string' && response.logoutUrl) {
        redirectUrl = response.logoutUrl;
      }
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : 'Failed to sign out.';
    }

    persistToken(null);
    hasStatus.value = true;
    user.value = null;

    return redirectUrl;
  };

  const clearError = () => {
    lastError.value = null;
  };

  const applySessionToken = (newToken) => {
    persistToken(newToken);
  };

  return {
    token,
    mode,
    oidc,
    user,
    requiresSetup,
    isLoading,
    hasStatus,
    isAuthenticated,
    isOidcMode,
    lastError,
    initialize,
    ensureStatus: initialize,
    setupPassword,
    login,
    beginOidcLogin,
    logout,
    clearError,
    applySessionToken,
  };
});
