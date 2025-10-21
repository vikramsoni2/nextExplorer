import { defineStore } from 'pinia';

/**
 * @typedef {import('@/types').UppyInstance} UppyInstance
 */

export const useUppyStore = defineStore({
  id: 'uppyStore',
  state: () => ({
    /** @type {UppyInstance | null} */
    uppy: null,
    /** @type {Record<string, unknown>} */
    state: {}
  }),

  actions: {
    /**
     * Returns the latest serialized Uppy state.
     * @returns {Record<string, unknown>}
     */
    getState() {
      return this.state;
    },

    /**
     * Merge a patch into the stored Uppy state and Pinia store.
     * @param {Record<string, unknown>} patch
     */
    setState(patch) {
      const prevState = this.state;
      const nextState = { ...prevState, ...patch };

      this.state = nextState;

      this.$patch({
        state: nextState
      });
    },

    /**
     * Subscribe to store changes and relay the mutation payload.
     * @param {(previousState: any, nextState: any, patch: any) => void} listener
     * @returns {() => void}
     */
    subscribe(listener) {
      const unsubscribe = this.$subscribe((mutation, state) => {
        const patch = mutation.payload;
        listener(mutation.oldState, state, patch);
      }, { immediate: true });

      return unsubscribe;
    }
  }
});
