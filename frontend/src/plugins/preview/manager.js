import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { getPreviewUrl, normalizePath, fetchFileContent } from '@/api';
import { useFileStore } from '@/stores/fileStore';
import { useFeaturesStore } from '@/stores/features';
import router from '@/router';
import { buildDownloadAction, submitDownloadForm } from '@/utils/download';

export const usePreviewManager = defineStore('preview-manager', () => {
  const plugins = ref([]);
  const activeItem = ref(null);
  const activePlugin = ref(null);
  const isOpen = computed(() => !!activeItem.value);

  const getExtension = (item) => {
    if (!item) return '';
    const kind = String(item.kind || '').toLowerCase();
    if (kind && kind !== 'directory') return kind;
    
    const name = String(item.name || '');
    const lastDot = name.lastIndexOf('.');
    return lastDot > 0 ? name.slice(lastDot + 1).toLowerCase() : '';
  };

  // Helper: Build full path
  const getFullPath = (item) => {
    if (!item?.name) return '';
    const parent = normalizePath(item.path || '');
    return normalizePath(parent ? `${parent}/${item.name}` : item.name);
  };

  // Get siblings from the same directory
  const getSiblings = (target) => {
    const fileStore = useFileStore();
    const base = target || {};
    const items = fileStore.getCurrentPathItems || [];
    return items
  };

  const createApi = (item) => ({
    getPreviewUrl: (targetItem) => getPreviewUrl(getFullPath(targetItem || item)),
    fetchContent: () => fetchFileContent(getFullPath(item)),
    getSiblings: (target) => getSiblings(target || item),
    openEditor: () => {
      const path = getFullPath(item);
      if (path) {
        // Encode each segment to handle special characters like #
        const encodedPath = path.split('/').map(encodeURIComponent).join('/');
        router.push({ path: `/editor/${encodedPath}` });
      }
    },
    download: async () => {
      const path = getFullPath(item);
      if (!path) return;

      const fileStore = useFileStore();
      const featuresStore = useFeaturesStore();
      const basePath = normalizePath(fileStore.getCurrentPath || item.path || '');
      const action = buildDownloadAction('/api/download', featuresStore.downloadPublicUrl);
      const fields = [
        { name: 'paths', value: path },
        { name: 'basePath', value: basePath },
      ];
      submitDownloadForm(action, fields);
    },
    close: () => close(),
  });

  // Plugin Management
  const register = (plugin) => {
    if (!plugin?.id) return;
    
    // Remove existing plugin with same id
    plugins.value = plugins.value.filter(p => p.id !== plugin.id);
    
    // Add and sort by priority (descending)
    plugins.value.push(plugin);
    plugins.value.sort((a, b) => {
      const priorityA = a.priority ?? 0;
      const priorityB = b.priority ?? 0;
      return priorityB - priorityA || a.id.localeCompare(b.id);
    });
  };

  const unregister = (pluginId) => {
    plugins.value = plugins.value.filter(p => p.id !== pluginId);
  };

  // Find matching plugin
  const findPlugin = (item) => {
    if (!item) return null;
    
    const extension = getExtension(item);
    const fullPath = getFullPath(item);
    const previewUrl = getPreviewUrl(fullPath);
    const api = createApi(item);

    const context = {
      item: { ...item },
      extension,
      filePath: fullPath,
      previewUrl,
      api,
    };

    // Find first matching plugin
    for (const plugin of plugins.value) {
      try {
        if (plugin.match?.(context)) {
          return { plugin, context };
        }
      } catch (error) {
        console.error(`Plugin ${plugin.id} match error:`, error);
      }
    }

    return null;
  };

  const open = (item) => {
    const match = findPlugin(item);
    if (!match) return false;

    const { plugin, context } = match;

    try {
      plugin.onOpen?.(context);
    } catch (error) {
      console.error(`Plugin ${plugin.id} onOpen error:`, error);
    }

    activeItem.value = context;
    activePlugin.value = plugin;

    return true;
  };

  const close = () => {
    if (!activePlugin.value || !activeItem.value) return;

    try {
      activePlugin.value.onClose?.(activeItem.value);
    } catch (error) {
      console.error(`Plugin ${activePlugin.value.id} onClose error:`, error);
    }

    activeItem.value = null;
    activePlugin.value = null;
  };

  return {
    // State
    plugins,
    isOpen,
    activeItem,
    activePlugin,
    
    // Actions
    register,
    unregister,
    open,
    close,
    findPlugin,
  };
});
