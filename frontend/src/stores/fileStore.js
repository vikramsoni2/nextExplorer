import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  browse,
  copyItems,
  moveItems,
  deleteItems,
  normalizePath,
  createFolder as createFolderApi,
  renameItem as renameItemApi,
  fetchThumbnail as fetchThumbnailApi,
} from '@/api';
import { useSettingsStore } from '@/stores/settings';
import { useAppSettings } from '@/stores/appSettings';

/**
 * @typedef {import('@/types').FileItem} FileItem
 * @typedef {import('@/types').RenameState} RenameState
 */

export const useFileStore = defineStore('fileStore', () => {
  // State
  /** @type {import('vue').Ref<string>} */
  const currentPath = ref('');
  /** @type {import('vue').Ref<FileItem[]>} */
  const currentPathItems = ref([]);
  /** @type {import('vue').Ref<FileItem[]>} */
  const selectedItems = ref([]);
  /** @type {import('vue').Ref<RenameState | null>} */
  const renameState = ref(null);

  /** @type {import('vue').Ref<FileItem[]>} */
  const copiedItems = ref([]);
  /** @type {import('vue').Ref<FileItem[]>} */
  const cutItems = ref([]);
  /** @type {Map<string, Promise<string | null>>} */
  const thumbnailRequests = new Map();

  /** @type {import('vue').ComputedRef<boolean>} */
  const hasSelection = computed(() => selectedItems.value.length > 0);
  /** @type {import('vue').ComputedRef<boolean>} */
  const hasClipboardItems = computed(() => copiedItems.value.length > 0 || cutItems.value.length > 0);

  /**
   * Generate a stable identifier for a file item.
   * @param {FileItem | null | undefined} item
   * @returns {string}
   */
  const itemKey = (item) => {
    if (!item || !item.name) {
      return '';
    }

    const parent = normalizePath(item.path || '');
    return `${parent}::${item.name}`;
  };

  /**
   * Locate an item in the current directory by its composite key.
   * @param {string} key
   * @returns {FileItem | undefined}
   */
  const findItemByKey = (key) => currentPathItems.value.find((item) => itemKey(item) === key);

  /**
   * Resolve the normalized relative path for an item.
   * @param {FileItem | null | undefined} item
   * @returns {string | null}
   */
  const resolveItemRelativePath = (item) => {
    if (!item || !item.name) {
      return null;
    }

    const parent = normalizePath(item.path || '');
    const combined = parent ? `${parent}/${item.name}` : item.name;
    return normalizePath(combined);
  };

  /**
   * Prepare payload objects for move/copy/delete operations.
   * @param {FileItem[]} items
   * @returns {Array<{ name: string, path: string, kind: string }>}
   */
  const serializeItems = (items) => items
    .filter((item) => item && item.name && item.kind !== 'volume')
    .map((item) => ({
      name: item.name,
      path: normalizePath(item.path || ''),
      kind: item.kind,
    }));

  /**
   * Clear both copy and cut buffers.
   */
  const resetClipboard = () => {
    copiedItems.value = [];
    cutItems.value = [];
  };

  /**
   * Copy the current selection into the clipboard buffer.
   */
  const copy = () => {
    if (!hasSelection.value) return;
    cutItems.value = [];
    copiedItems.value = selectedItems.value.map((item) => ({ ...item }));
  };

  /**
   * Cut the current selection into the clipboard buffer.
   */
  const cut = () => {
    if (!hasSelection.value) return;
    copiedItems.value = [];
    cutItems.value = selectedItems.value.map((item) => ({ ...item }));
  };

  /**
   * Apply the clipboard contents to the current path.
   * @returns {Promise<void>}
   */
  const paste = async () => {
    const destination = normalizePath(currentPath.value || '');

    if (copiedItems.value.length > 0) {
      const payload = serializeItems(copiedItems.value);
      if (payload.length > 0) {
        await copyItems(payload, destination);
      }
      copiedItems.value = [];
    }

    if (cutItems.value.length > 0) {
      const payload = serializeItems(cutItems.value);
      if (payload.length > 0) {
        await moveItems(payload, destination);
      }
      cutItems.value = [];
    }

    await fetchPathItems(destination);
  };

  /**
   * Delete the selected items from the backend and refresh the directory listing.
   * @returns {Promise<void>}
   */
  const del = async () => {
    const payload = serializeItems(selectedItems.value);
    if (payload.length === 0) return;

    await deleteItems(payload);
    selectedItems.value = [];
    await fetchPathItems(currentPath.value);
  };

  /**
   * Create a new folder and immediately select it for renaming.
   * @param {string} baseName
   * @returns {Promise<{ item?: FileItem }>}
   */
  const createFolder = async (baseName) => {
    const destination = normalizePath(currentPath.value || '');
    const response = await createFolderApi(destination, baseName);
    const createdName = response?.item?.name;

    await fetchPathItems(destination);

    if (createdName) {
      const createdKey = `${destination}::${createdName}`;
      const createdItem = findItemByKey(createdKey);
      if (createdItem) {
        selectedItems.value = [createdItem];
        beginRename(createdItem, { isNew: true });
      }
    }

    return response;
  };

  /**
   * Enter rename mode for an item.
   * @param {FileItem} item
   * @param {{ isNew?: boolean }} [options]
   */
  const beginRename = (item, options = {}) => {
    if (!item || !item.name) return;

    const key = itemKey(item);
    const existing = findItemByKey(key);
    const target = existing || { ...item };

    selectedItems.value = [target];

    renameState.value = {
      key,
      path: normalizePath(target.path || currentPath.value || ''),
      originalName: target.name,
      draft: target.name,
      kind: target.kind,
      isNew: Boolean(options.isNew),
    };
  };

  /**
   * Update the rename text as the user types.
   * @param {string} value
   */
  const setRenameDraft = (value) => {
    if (!renameState.value) return;
    renameState.value.draft = value;
  };

  /**
   * Abort the rename operation and restore state.
   */
  const cancelRename = () => {
    renameState.value = null;
  };

  /**
   * Persist the rename operation via the API.
   * @returns {Promise<void>}
   */
  const applyRename = async () => {
    const state = renameState.value;
    if (!state) return;

    const newName = state.draft ?? '';
    if (!newName.trim()) {
      renameState.value = null;
      return;
    }

    if (newName === state.originalName) {
      renameState.value = null;
      return;
    }

    const targetPath = state.path;

    const response = await renameItemApi(targetPath, state.originalName, newName);
    const renamedName = response?.item?.name ?? newName;
    renameState.value = null;
    await fetchPathItems(targetPath);
    const renamedKey = `${targetPath}::${renamedName}`;
    const renamedItem = findItemByKey(renamedKey);
    if (renamedItem) {
      selectedItems.value = [renamedItem];
    }
  };

  /**
   * Check if the provided item is currently undergoing rename.
   * @param {FileItem} item
   * @returns {boolean}
   */
  const isItemBeingRenamed = (item) => {
    if (!renameState.value) return false;
    return itemKey(item) === renameState.value.key;
  };

  /**
   * Fetch a thumbnail for an individual item if one is not cached.
   * @param {FileItem | null | undefined} item
   * @returns {Promise<string | null> | null}
   */
  const ensureItemThumbnail = async (item) => {
    if (!item || !item.name) {
      return null;
    }

    const kind = (item.kind || '').toLowerCase();
    if (kind === 'directory' || kind === 'pdf') {
      return null;
    }

    // Respect app settings: if thumbnails disabled or settings not yet loaded, skip
    try {
      const appSettings = useAppSettings();
      if (!appSettings.loaded) {
        if (!appSettings.loading) await appSettings.load();
      }
      if (appSettings.loaded && appSettings.state.thumbnails?.enabled === false) {
        return null;
      }
    } catch (e) {
      // If settings store fails, fail open to avoid breaking UI, but do not spam
    }

    const key = itemKey(item);
    if (!key) {
      return null;
    }

    const existing = findItemByKey(key);
    if (existing?.thumbnail) {
      return existing.thumbnail;
    }

    let pending = thumbnailRequests.get(key);
    if (!pending) {
      const relativePath = resolveItemRelativePath(item);
      if (!relativePath) {
        return null;
      }

      pending = (async () => {
        try {
          const response = await fetchThumbnailApi(relativePath);
          const thumbnail = response?.thumbnail || '';
          if (thumbnail) {
            const target = findItemByKey(key);
            if (target) {
              target.thumbnail = thumbnail;
            }
          }
          return thumbnail || null;
        } catch (error) {
          console.error(`Failed to fetch thumbnail for ${relativePath}`, error);
          return null;
        } finally {
          thumbnailRequests.delete(key);
        }
      })();

      thumbnailRequests.set(key, pending);
    }

    return pending;
  };
  
  // Getters
  /** @type {import('vue').ComputedRef<string>} */
  const getCurrentPath = computed(() => currentPath.value);

  /**
   * Computed list of items sorted according to user preferences.
   * @type {import('vue').ComputedRef<FileItem[]>}
   */
  const getCurrentPathItems = computed(() => {
    const settings = useSettingsStore();
    const direction = settings.sortBy.order === 'asc' ? 1 : -1;

    return [...currentPathItems.value].sort((a, b) => {
      if (a.kind === 'directory' && b.kind != 'directory') return -1;
      if (a.kind != 'directory' && b.kind === 'directory') return 1;
      const aValue = a[settings.sortBy.by];
      const bValue = b[settings.sortBy.by];
      if (aValue === bValue) return 0;
      return aValue > bValue ? direction : -direction;
    });
  });

  // Actions
  /**
   * Update the active path and normalize it for downstream usage.
   * @param {string} path
   */
  function setCurrentPath(path) {
    currentPath.value = normalizePath(path);
  }

  /**
   * Refresh the items for a given path and clear selection state.
   * @param {string} [path]
   * @returns {Promise<FileItem[]>}
   */
  async function fetchPathItems(path) {
    const normalizedPath = normalizePath(typeof path === 'string' ? path : currentPath.value);
    currentPath.value = normalizedPath;
    selectedItems.value = [];
    currentPathItems.value = await browse(normalizedPath);
    return currentPathItems.value;
  }

  return {
    currentPath,
    getCurrentPath,
    setCurrentPath,
    currentPathItems,
    getCurrentPathItems,
    fetchPathItems,
    selectedItems,
    copiedItems,
    cutItems,
    hasSelection,
    hasClipboardItems,
    copy, 
    cut,
    paste,
    del,
    resetClipboard,
    createFolder,
    renameState,
    beginRename,
    setRenameDraft,
    cancelRename,
    applyRename,
    isItemBeingRenamed,
    ensureItemThumbnail,
  };
});
