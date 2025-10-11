import { defineStore } from 'pinia';
import { reactive, ref } from 'vue';

import type Uppy from '@uppy/core';
import type { State as UppyState } from '@uppy/core';

interface UppyProgressState {
  bytesTotal?: number | null;
  bytesUploaded?: number | boolean | null;
  uploadComplete?: boolean;
  percentage?: number | null;
  uploadStarted?: number | null;
  [key: string]: unknown;
}

interface UppyFileState {
  id?: string;
  name?: string;
  type?: string;
  extension?: string;
  size?: number | null;
  error?: unknown;
  isPaused?: boolean;
  meta?: Record<string, unknown>;
  progress?: UppyProgressState;
  [key: string]: unknown;
}

export interface UppyClientState {
  files: Record<string, UppyFileState>;
  currentUploads: Record<string, unknown>;
  totalProgress: number;
  [key: string]: unknown;
}

const createDefaultState = (): UppyClientState => ({
  files: {},
  currentUploads: {},
  totalProgress: 0,
});

export const useUppyStore = defineStore('uppyStore', () => {
  const uppy = ref<Uppy | null>(null);
  const state = reactive<UppyClientState>(createDefaultState());
  const setState = (next: Partial<UppyState<Record<string, unknown>, Record<string, unknown>>> | unknown) => {
    const incoming = (next as UppyState<Record<string, unknown>, Record<string, unknown>>) ?? createDefaultState();
    const files = incoming.files ?? {};
    const normalisedFiles = Object.fromEntries(
      Object.entries(files).map(([id, file]) => {
        const { progress, ...rest } = file;
        const normalised: UppyFileState = {
          ...rest,
          progress: progress ? ({ ...progress } as UppyProgressState) : undefined,
        };
        return [id, normalised];
      }),
    );
    state.files = normalisedFiles;
    state.currentUploads = incoming.currentUploads ?? {};
    state.totalProgress = typeof incoming.totalProgress === 'number' ? incoming.totalProgress : 0;
  };

  const reset = () => {
    Object.assign(state, createDefaultState());
  };

  return {
    uppy,
    state,
    setState,
    reset,
  };
});
