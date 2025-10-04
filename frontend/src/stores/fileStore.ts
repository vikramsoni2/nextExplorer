import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import {
  browse,
  copyItems,
  createFolder as createFolderApi,
  deleteItems,
  fetchThumbnail as fetchThumbnailApi,
  moveItems,
  normalizePath,
  renameItem as renameItemApi,
  type CreateFolderResponse,
  type FileItem,
  type RenameItemResponse,
  type ThumbnailResponse,
  type TransferItemPayload,
} from '@/api';
import { useSettingsStore } from '@/stores/settings';

export interface ExplorerItem extends FileItem {}

export interface RenameState {
  key: string;
  path: string;
  originalName: string;
  draft: string;
  kind?: string;
  isNew?: boolean;
}

export const useFileStore = defineStore('fileStore', () => {
  // State
  const currentPath = ref<string>('');
  const currentPathItems = ref<ExplorerItem[]>([]);
  const selectedItems = ref<ExplorerItem[]>([]);
  const renameState = ref<RenameState | null>(null);

  const copiedItems = ref<ExplorerItem[]>([]);
  const cutItems = ref<ExplorerItem[]>([]);
  const thumbnailRequests = new Map<string, Promise<string | null>>();

  const hasSelection = computed(() => selectedItems.value.length > 0);
  const hasClipboardItems = computed(() => copiedItems.value.length > 0 || cutItems.value.length > 0);

  const itemKey = (item: ExplorerItem | null | undefined): string => {
    if (!item || !item.name) {
      return '';
    }

    const parent = normalizePath(item.path || '');
    return `${parent}::${item.name}`;
  };

  const findItemByKey = (key: string): ExplorerItem | undefined => currentPathItems.value.find((item) => itemKey(item) === key);

  const resolveItemRelativePath = (item: ExplorerItem | null | undefined): string | null => {
    if (!item || !item.name) {
      return null;
    }

    const parent = normalizePath(item.path || '');
    const combined = parent ? `${parent}/${item.name}` : item.name;
    return normalizePath(combined);
  };

  const serializeItems = (items: ExplorerItem[]): TransferItemPayload[] => items
    .filter((item) => item && item.name && item.kind !== 'volume')
    .map((item) => ({
      name: item.name,
      path: normalizePath(item.path || ''),
      kind: item.kind,
    }));

  const resetClipboard = (): void => {
    copiedItems.value = [];
    cutItems.value = [];
  };

  const copy = (): void => {
    if (!hasSelection.value) return;
    cutItems.value = [];
    copiedItems.value = selectedItems.value.map((item) => ({ ...item }));
  };

  const cut = (): void => {
    if (!hasSelection.value) return;
    copiedItems.value = [];
    cutItems.value = selectedItems.value.map((item) => ({ ...item }));
  };

  const paste = async (): Promise<void> => {
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

  const del = async (): Promise<void> => {
    const payload = serializeItems(selectedItems.value);
    if (payload.length === 0) return;

    await deleteItems(payload);
    selectedItems.value = [];
    await fetchPathItems(currentPath.value);
  };

  const createFolder = async (baseName?: string): Promise<CreateFolderResponse> => {
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

  const beginRename = (item: ExplorerItem, options: { isNew?: boolean } = {}): void => {
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

  const setRenameDraft = (value: string): void => {
    if (!renameState.value) return;
    renameState.value.draft = value;
  };

  const cancelRename = (): void => {
    renameState.value = null;
  };

  const applyRename = async (): Promise<void> => {
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

    try {
      const response: RenameItemResponse = await renameItemApi(targetPath, state.originalName, newName);
      const renamedName = response?.item?.name ?? newName;
      renameState.value = null;
      await fetchPathItems(targetPath);
      const renamedKey = `${targetPath}::${renamedName}`;
      const renamedItem = findItemByKey(renamedKey);
      if (renamedItem) {
        selectedItems.value = [renamedItem];
      }
    } catch (error) {
      throw error;
    }
  };

  const isItemBeingRenamed = (item: ExplorerItem): boolean => {
    if (!renameState.value) return false;
    return itemKey(item) === renameState.value.key;
  };

  const ensureItemThumbnail = async (item: ExplorerItem): Promise<string | null> => {
    if (!item || !item.name) {
      return null;
    }

    const kind = (item.kind || '').toLowerCase();
    if (kind === 'directory' || kind === 'pdf') {
      return null;
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
          const response: ThumbnailResponse = await fetchThumbnailApi(relativePath);
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
  const getCurrentPath = computed(() => currentPath.value);

  // get sorted currentPathItems
  const getCurrentPathItems = computed<ExplorerItem[]>(() => {
    const settings = useSettingsStore();
    const direction = settings.sortBy.order === 'asc' ? 1 : -1;

    return [...currentPathItems.value].sort((a, b) => {
      if (a.kind === 'directory' && b.kind !== 'directory') return -1;
      if (a.kind !== 'directory' && b.kind === 'directory') return 1;
      const sortKey = settings.sortBy.by as keyof ExplorerItem;
      const aValue = a[sortKey];
      const bValue = b[sortKey];
      if (aValue === bValue) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;
      return aValue > bValue ? direction : -direction;
    });
  });

  // Actions
  function setCurrentPath(path: string): void {
    currentPath.value = normalizePath(path);
  }

  async function fetchPathItems(path?: string): Promise<ExplorerItem[]> {
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
