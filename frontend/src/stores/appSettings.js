import { defineStore } from 'pinia';
import { ref } from 'vue';
import { getSettings as getSettingsApi, patchSettings as patchSettingsApi } from '@/api';

/**
 * @typedef {import('@/types').AppSettingsState} AppSettingsState
 */

const defaultState = () => /** @type {AppSettingsState} */ ({
  thumbnails: { enabled: true, size: 200, quality: 70 },
  security: { authEnabled: true },
  access: { rules: [] },
});

const defaults = defaultState();

export const useAppSettings = defineStore('appSettings', () => {
  /** @type {import('vue').Ref<boolean>} */
  const loaded = ref(false);
  /** @type {import('vue').Ref<boolean>} */
  const loading = ref(false);
  /** @type {import('vue').Ref<string | null>} */
  const lastError = ref(null);
  /** @type {import('vue').Ref<AppSettingsState>} */
  const state = ref(defaultState());

  /**
   * Load settings from the backend and merge defaults.
   * @returns {Promise<void>}
   */
  const load = async () => {
    loading.value = true;
    lastError.value = null;
    try {
      const s = await getSettingsApi();
      state.value = {
        thumbnails: { ...defaults.thumbnails, ...(s?.thumbnails || {}) },
        security: { ...defaults.security, ...(s?.security || {}) },
        access: { rules: Array.isArray(s?.access?.rules) ? s.access.rules : [] },
      };
      loaded.value = true;
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : 'Failed to load settings';
    } finally {
      loading.value = false;
    }
  };

  /**
   * Persist partial settings and update the local state.
   * @param {Partial<AppSettingsState>} partial
   * @returns {Promise<AppSettingsState>}
   */
  const save = async (partial) => {
    lastError.value = null;
    const updated = await patchSettingsApi(partial);
    state.value = {
      thumbnails: { ...defaults.thumbnails, ...(updated?.thumbnails || {}) },
      security: { ...defaults.security, ...(updated?.security || {}) },
      access: { rules: Array.isArray(updated?.access?.rules) ? updated.access.rules : [] },
    };
    loaded.value = true;
    return state.value;
  };

  return { state, loaded, loading, lastError, load, save };
});
