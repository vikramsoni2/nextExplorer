import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';

import { fetchFileContent, getPreviewUrl, normalizePath, downloadItems } from '@/api';
import router from '@/router';
import type {
  PreviewContext,
  PreviewItem,
  PreviewManager,
  PreviewPlugin,
} from './types';

const resolveExtension = (item: PreviewItem | null | undefined): string => {
  if (!item) return '';
  if (item.kind && item.kind !== 'directory') {
    return String(item.kind).toLowerCase();
  }
  if (typeof item.name === 'string' && item.name.includes('.')) {
    return item.name.split('.').pop().toLowerCase();
  }
  return '';
};

const toFullPath = (item: PreviewItem | null | undefined): string => {
  if (!item || !item.name) return '';
  const parent = normalizePath(item.path || '');
  const target = parent ? `${parent}/${item.name}` : item.name;
  return normalizePath(target);
};

const buildDownload = async (path: string, fallbackName?: string): Promise<void> => {
  const response = await downloadItems([path]);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fallbackName || path.split('/').pop() || 'download';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const usePreviewManager = defineStore('preview-manager', () => {
  const registered = ref<PreviewPlugin[]>([]);
  const current = shallowRef<{ plugin: PreviewPlugin; context: PreviewContext } | null>(null);

  const isOpen = computed(() => Boolean(current.value));
  const currentPlugin = computed(() => current.value?.plugin ?? null);
  const currentContext = computed(() => current.value?.context ?? null);

  const managerApi = {} as PreviewManager;

  const buildContext = (item: PreviewItem | null | undefined, plugin: PreviewPlugin): PreviewContext => {
    const snapshot = item ? { ...item } : null;
    const extension = resolveExtension(snapshot);
    const filePath = toFullPath(snapshot);
    const previewUrl = filePath ? getPreviewUrl(filePath) : null;

    const api = {
      getPreviewUrl: (targetPath = filePath): string | null => {
        if (!targetPath) return null;
        return getPreviewUrl(normalizePath(targetPath));
      },
      fetchFileContent: (targetPath = filePath) => {
        if (!targetPath) {
          return Promise.reject(new Error('Path is required to fetch content.'));
        }
        return fetchFileContent(normalizePath(targetPath));
      },
      openEditor: (targetPath = filePath): void => {
        if (!targetPath) return;
        const normalized = normalizePath(targetPath);
        if (!normalized) return;
        router.push({ path: `/editor/${normalized}` });
      },
      closePreview: (): void => {
        managerApi.close();
      },
      download: (targetPath = filePath): void => {
        if (!targetPath) return;
        const normalized = normalizePath(targetPath);
        if (!normalized) return;
        buildDownload(normalized, snapshot?.name).catch((error) => {
          console.error('Download failed', error);
        });
      },
    };

    return {
      item: snapshot,
      extension,
      previewUrl,
      filePath,
      manager: managerApi,
      api,
      plugin,
    };
  };

  const sortByPriority = (plugins: PreviewPlugin[]): PreviewPlugin[] => {
    return [...plugins].sort((a, b) => {
      const priorityA = typeof a.priority === 'number' ? a.priority : 0;
      const priorityB = typeof b.priority === 'number' ? b.priority : 0;
      if (priorityA === priorityB) {
        return a.id.localeCompare(b.id);
      }
      return priorityB - priorityA;
    });
  };

  const register = (plugin: PreviewPlugin): void => {
    if (!plugin || !plugin.id) return;
    const existingIndex = registered.value.findIndex((entry) => entry.id === plugin.id);
    const next = [...registered.value];
    if (existingIndex >= 0) {
      next.splice(existingIndex, 1, plugin);
    } else {
      next.push(plugin);
    }
    registered.value = sortByPriority(next);
  };

  const unregister = (pluginId: string): void => {
    if (!pluginId) return;
    registered.value = registered.value.filter((plugin) => plugin.id !== pluginId);
  };

  const findPlugin = (item: PreviewItem | null | undefined): { plugin: PreviewPlugin; context: PreviewContext } | null => {
    if (!item) return null;
    for (const plugin of registered.value) {
      try {
        const context = buildContext(item, plugin);
        if (plugin.match?.(context)) {
          return { plugin, context };
        }
      } catch (error) {
        console.error(`Preview plugin match failed for ${plugin.id}`, error);
      }
    }
    return null;
  };

  const open = (item: PreviewItem | null | undefined): boolean => {
    const resolution = findPlugin(item);
    if (!resolution) {
      return false;
    }

    const { plugin, context } = resolution;

    if (plugin.onOpen) {
      try {
        plugin.onOpen(context);
      } catch (error) {
        console.error(`Preview plugin onOpen failed for ${plugin.id}`, error);
      }
    }

    current.value = {
      plugin,
      context,
    };

    return true;
  };

  const close = (): void => {
    if (!current.value) return;
    const { plugin, context } = current.value;
    if (plugin?.onClose) {
      try {
        plugin.onClose(context);
      } catch (error) {
        console.error(`Preview plugin onClose failed for ${plugin.id}`, error);
      }
    }
    current.value = null;
  };

  Object.assign(
    managerApi,
    {
      register,
      unregister,
      findPlugin,
      open,
      close,
      getCurrent: () => currentContext.value,
      getPlugins: () => [...registered.value],
    } satisfies PreviewManager,
  );

  return {
    plugins: registered,
    current,
    currentPlugin,
    currentContext,
    isOpen,
    register,
    unregister,
    findPlugin,
    open,
    close,
  };
});
