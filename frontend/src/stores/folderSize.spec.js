import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const getFolderSizesBatch = vi.fn();
const refreshFolderSize = vi.fn();
const ensureLoaded = vi.fn(() => Promise.resolve());
const featuresState = { folderSizeEnabled: true };

vi.mock('@/api', () => ({
  getFolderSizesBatch: (...args) => getFolderSizesBatch(...args),
  refreshFolderSize: (...args) => refreshFolderSize(...args),
  normalizePath: (p) => (p || '').replace(/^\/+|\/+$/g, ''),
}));

vi.mock('@/stores/features', () => ({
  useFeaturesStore: () => ({
    ensureLoaded,
    get folderSizeEnabled() {
      return featuresState.folderSizeEnabled;
    },
  }),
}));

import { useFolderSizeStore } from '@/stores/folderSize';

describe('folderSize store', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    setActivePinia(createPinia());
    featuresState.folderSizeEnabled = true;
    ensureLoaded.mockClear();
    getFolderSizesBatch.mockReset();
    refreshFolderSize.mockReset();
    getFolderSizesBatch.mockResolvedValue({ results: [] });
  });

  it('fetches tracked paths and stores results keyed by path', async () => {
    getFolderSizesBatch.mockResolvedValue({
      results: [{ path: 'A', sizeBytes: 100, entryCount: 2, canEnter: true, indexed: true }],
    });

    const store = useFolderSizeStore();
    await store.refresh({ force: true, paths: ['A', 'A/B'] });

    expect(getFolderSizesBatch).toHaveBeenCalledTimes(1);
    expect(getFolderSizesBatch).toHaveBeenCalledWith(['A', 'A/B'], {
      suppressErrorHandler: true,
      retryNetworkErrors: true,
    });
    expect(store.sizeFor('A')).toMatchObject({ sizeBytes: 100, entryCount: 2 });
  });

  it('respects the refresh throttle for non-forced calls', async () => {
    const store = useFolderSizeStore();
    store.setPaths(['A']);

    await store.refresh({ force: true }); // primes lastRefreshAt
    await store.refresh({ force: false }); // within throttle window -> skipped

    expect(getFolderSizesBatch).toHaveBeenCalledTimes(1);
  });

  it('does not double-fetch while a refresh is already in flight (same paths)', async () => {
    let resolveFetch;
    getFolderSizesBatch.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );

    const store = useFolderSizeStore();
    store.setPaths(['A']);

    const first = store.refresh({ force: true });
    const second = store.refresh({ force: true });
    resolveFetch({ results: [] });
    await Promise.all([first, second]);

    expect(getFolderSizesBatch).toHaveBeenCalledTimes(1);
  });

  it('re-fetches the latest paths when they change mid-flight (navigation)', async () => {
    const calls = [];
    let resolveFirst;
    getFolderSizesBatch.mockImplementation((paths) => {
      calls.push(paths);
      if (calls.length === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve({ results: [] });
    });

    const store = useFolderSizeStore();
    const first = store.ensureSizes(['A']); // starts a batch for A (kept in flight)
    await vi.waitFor(() => expect(getFolderSizesBatch).toHaveBeenCalledTimes(1));

    const second = store.ensureSizes(['B']); // navigate to B while A is still loading
    resolveFirst({ results: [] });
    await Promise.all([first, second]);

    // B must not be dropped: it is fetched once A settles.
    expect(calls).toEqual([['A'], ['B']]);
  });

  it('clears sizes and skips fetching when the feature is disabled', async () => {
    featuresState.folderSizeEnabled = false;

    const store = useFolderSizeStore();
    await store.refresh({ force: true, paths: ['A'] });

    expect(getFolderSizesBatch).not.toHaveBeenCalled();
    expect(store.sizeFor('A')).toBeNull();
  });

  it('does not schedule an inert refresh timer when the feature is disabled', () => {
    featuresState.folderSizeEnabled = false;
    const store = useFolderSizeStore();

    store.scheduleRefresh();

    expect(getFolderSizesBatch).not.toHaveBeenCalled();
  });

  it('queues an explicit subtree refresh without keeping the UI request open', async () => {
    refreshFolderSize.mockResolvedValue({
      path: 'A/External',
      sizeBytes: 0,
      entryCount: 4,
      canEnter: true,
      indexed: true,
      refreshPending: true,
    });

    const store = useFolderSizeStore();
    const entry = await store.refreshFolder('A/External');

    expect(refreshFolderSize).toHaveBeenCalledWith('A/External');
    expect(entry).toMatchObject({ sizeBytes: 0, indexed: true, refreshPending: true });
    expect(store.sizeFor('A/External')).toMatchObject({ sizeBytes: 0, entryCount: 4 });
  });

  it('re-fetches a visible directory while its authoritative scan is pending', async () => {
    vi.useFakeTimers();
    getFolderSizesBatch
      .mockResolvedValueOnce({
        results: [{ path: 'A', sizeBytes: 0, entryCount: 2, indexed: true, dirty: true }],
      })
      .mockResolvedValueOnce({
        results: [{ path: 'A', sizeBytes: 123, entryCount: 2, indexed: true, dirty: false }],
      });

    const store = useFolderSizeStore();
    await store.refresh({ force: true, paths: ['A'] });
    await vi.advanceTimersByTimeAsync(2000);

    expect(getFolderSizesBatch).toHaveBeenCalledTimes(2);
    expect(store.sizeFor('A')).toMatchObject({ sizeBytes: 123, dirty: false });
  });
});
