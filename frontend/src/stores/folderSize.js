import { defineStore } from 'pinia';
import { ref } from 'vue';
import { getFolderSizesBatch, normalizePath, refreshFolderSize } from '@/api';
import { useFeaturesStore } from '@/stores/features';

const REFRESH_THROTTLE_MS = 2500;
const MANUAL_REFRESH_POLL_MS = 1500;
const MANUAL_REFRESH_MAX_POLLS = 400;
const DIRTY_REFRESH_INITIAL_MS = 2000;
const DIRTY_REFRESH_MAX_MS = 15000;

const normalizeEntry = (raw = {}) => ({
  path: normalizePath(raw.path || ''),
  sizeBytes: Number.isFinite(raw.sizeBytes) ? raw.sizeBytes : null,
  entryCount: Number.isFinite(raw.entryCount) ? raw.entryCount : null,
  canEnter: Boolean(raw.canEnter),
  indexed: Boolean(raw.indexed),
  dirty: Boolean(raw.dirty),
  excluded: Boolean(raw.excluded),
  lastUpdated: raw.lastUpdated || null,
});

const samePaths = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

/**
 * Store for pre-computed folder sizes. Mirrors the volumeUsage store's shape
 * (reactive map keyed by normalized path, throttle + refreshPromise guard,
 * scheduleRefresh) but tracks the set of folder paths currently visible and
 * populates them in a single batch request.
 */
export const useFolderSizeStore = defineStore('folderSize', () => {
  const sizes = ref({});
  const isLoading = ref(false);

  let refreshPromise = null;
  let refreshTimer = null;
  let lastRefreshAt = 0;
  let trackedPaths = [];
  let queuedRefresh = false;
  let inFlightTargets = null;
  const pendingManualRefreshes = new Map();
  let dirtyRefreshTimer = null;
  let dirtyRefreshDelay = DIRTY_REFRESH_INITIAL_MS;

  const clearDisabledState = () => {
    sizes.value = {};
    queuedRefresh = false;

    if (refreshTimer) {
      window.clearTimeout(refreshTimer);
      refreshTimer = null;
    }

    if (dirtyRefreshTimer) {
      window.clearTimeout(dirtyRefreshTimer);
      dirtyRefreshTimer = null;
    }
    dirtyRefreshDelay = DIRTY_REFRESH_INITIAL_MS;

    for (const timer of pendingManualRefreshes.values()) {
      window.clearTimeout(timer);
    }
    pendingManualRefreshes.clear();
  };

  const mergeEntries = (rawEntries = []) => {
    const next = { ...sizes.value };
    for (const raw of rawEntries) {
      const entry = normalizeEntry(raw);
      if (entry.path) next[entry.path] = entry;
    }
    sizes.value = next;
  };

  const setPaths = (paths = []) => {
    const seen = new Set();
    trackedPaths = [];
    for (const p of paths) {
      const key = normalizePath(p || '');
      if (key && !seen.has(key)) {
        seen.add(key);
        trackedPaths.push(key);
      }
    }
  };

  const sizeFor = (path) => {
    const key = normalizePath(path || '');
    return key ? sizes.value[key] || null : null;
  };

  // Fetch the given paths in one batch and merge the results into `sizes`.
  const fetchSizes = async (targets) => {
    try {
      const response = await getFolderSizesBatch(targets, {
        // Folder sizes improve the view but must never turn a transient server
        // overload during navigation/reload into a global network alert.
        suppressErrorHandler: true,
        retryNetworkErrors: true,
      });
      const results = Array.isArray(response?.results) ? response.results : [];
      mergeEntries(results);
      lastRefreshAt = Date.now();

      // A copied or moved directory is intentionally exposed as dirty while
      // its final subtree scan runs. Re-read only the current view, with a
      // bounded exponential backoff, so its final size appears without a page
      // reload and without polling an entire large tree.
      const hasDirtyVisibleEntry = results.some((raw) => {
        const entry = normalizeEntry(raw);
        return entry.dirty && trackedPaths.includes(entry.path);
      });
      if (hasDirtyVisibleEntry) {
        if (!dirtyRefreshTimer) {
          const delay = dirtyRefreshDelay;
          dirtyRefreshDelay = Math.min(dirtyRefreshDelay * 2, DIRTY_REFRESH_MAX_MS);
          dirtyRefreshTimer = window.setTimeout(() => {
            dirtyRefreshTimer = null;
            refresh({ force: true }).catch(() => {});
          }, delay);
        }
      } else {
        if (dirtyRefreshTimer) {
          window.clearTimeout(dirtyRefreshTimer);
          dirtyRefreshTimer = null;
        }
        dirtyRefreshDelay = DIRTY_REFRESH_INITIAL_MS;
      }
    } catch (_) {
      // Non-fatal: leave any previously known sizes in place.
    }
  };

  const refresh = async ({ force = false, paths } = {}) => {
    const featuresStore = useFeaturesStore();
    await featuresStore.ensureLoaded();

    if (!featuresStore.folderSizeEnabled) {
      clearDisabledState();
      return;
    }

    if (Array.isArray(paths)) {
      setPaths(paths);
    }

    if (!trackedPaths.length) {
      return;
    }

    const now = Date.now();
    if (!force && now - lastRefreshAt < REFRESH_THROTTLE_MS) {
      return;
    }

    // A batch is already in flight. Don't silently drop this request: if the
    // tracked paths have changed since that batch started (e.g. the user
    // navigated into another folder while the previous batch was still loading),
    // queue exactly one follow-up that re-runs with the latest paths once the
    // current batch settles. Identical concurrent calls are genuine duplicates,
    // so we just share the in-flight promise.
    if (refreshPromise) {
      if (!samePaths(trackedPaths, inFlightTargets)) {
        queuedRefresh = true;
      }
      return refreshPromise;
    }

    isLoading.value = true;
    refreshPromise = (async () => {
      try {
        do {
          queuedRefresh = false;
          inFlightTargets = [...trackedPaths];
          await fetchSizes(inFlightTargets);
        } while (queuedRefresh);
      } finally {
        refreshPromise = null;
        inFlightTargets = null;
        isLoading.value = false;
      }
    })();

    return refreshPromise;
  };

  /**
   * Track and fetch sizes for the folders currently in view. Forced so a fresh
   * navigation always populates, while the refreshPromise guard still prevents
   * an overlapping duplicate request.
   */
  const ensureSizes = async (paths = []) => {
    setPaths(paths);
    if (!trackedPaths.length) return;
    await refresh({ force: true });
  };

  const scheduleRefresh = ({ delayMs = 500, force = true } = {}) => {
    if (!useFeaturesStore().folderSizeEnabled) {
      clearDisabledState();
      return;
    }

    if (refreshTimer) {
      window.clearTimeout(refreshTimer);
    }
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      refresh({ force }).catch(() => {});
    }, delayMs);
  };

  const pollManualRefresh = (path, previousLastUpdated) => {
    if (pendingManualRefreshes.has(path)) return;

    let attempts = 0;
    const poll = async () => {
      try {
        const response = await getFolderSizesBatch([path], {
          suppressErrorHandler: true,
          retryNetworkErrors: false,
        });
        const raw = Array.isArray(response?.results) ? response.results[0] : null;
        const entry = normalizeEntry(raw || {});
        if (entry.path) {
          mergeEntries([entry]);
          if (entry.indexed && entry.lastUpdated && entry.lastUpdated !== previousLastUpdated) {
            pendingManualRefreshes.delete(path);
            return;
          }
        }
      } catch (_) {
        // The normal view refresh will retry later; do not raise a toast for a
        // background completion check after the user explicitly queued a scan.
      }

      attempts += 1;
      if (attempts >= MANUAL_REFRESH_MAX_POLLS) {
        pendingManualRefreshes.delete(path);
        return;
      }
      const timer = window.setTimeout(poll, MANUAL_REFRESH_POLL_MS);
      pendingManualRefreshes.set(path, timer);
    };

    const timer = window.setTimeout(poll, MANUAL_REFRESH_POLL_MS);
    pendingManualRefreshes.set(path, timer);
  };

  // Explicit repair for a folder changed outside NextExplorer. The server
  // acknowledges the queued scan immediately; a tiny single-row poll updates
  // the UI when the authoritative index entry is committed.
  const refreshFolder = async (path) => {
    const featuresStore = useFeaturesStore();
    await featuresStore.ensureLoaded();
    if (!featuresStore.folderSizeEnabled) return null;

    const raw = await refreshFolderSize(path);
    const entry = normalizeEntry(raw);
    if (!entry.path) return null;
    mergeEntries([entry]);
    if (raw?.refreshPending) pollManualRefresh(entry.path, entry.lastUpdated);
    return { ...entry, refreshPending: Boolean(raw?.refreshPending) };
  };

  return {
    sizes,
    isLoading,
    refresh,
    ensureSizes,
    scheduleRefresh,
    refreshFolder,
    setPaths,
    sizeFor,
  };
});
