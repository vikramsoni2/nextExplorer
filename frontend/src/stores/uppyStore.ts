import { defineStore } from 'pinia';

interface UppyStoreState {
  uppy: unknown;
  state: Record<string, unknown>;
}

type StateListener = (
  previousState: UppyStoreState,
  nextState: UppyStoreState,
  patch: unknown,
) => void;

export const useUppyStore = defineStore('uppyStore', {
  state: (): UppyStoreState => ({
    uppy: null,
    state: {},
  }),

  actions: {
    getState(): Record<string, unknown> {
      return this.state;
    },

    setState(patch: Record<string, unknown>): void {
      const prevState = this.state;
      const nextState = { ...prevState, ...patch };

      this.state = nextState;

      this.$patch({
        state: nextState,
      });
    },

    subscribe(listener: StateListener) {
      const unsubscribe = this.$subscribe((mutation, state) => {
        const patch = mutation.payload;
        listener(mutation.oldState as UppyStoreState, state as UppyStoreState, patch);
      }, { immediate: true });

      return unsubscribe;
    },
  },
});
