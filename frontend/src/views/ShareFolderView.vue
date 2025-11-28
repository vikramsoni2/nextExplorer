<script setup>
import { ref, onMounted, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useFileStore } from '@/stores/fileStore';
import LoadingIcon from '@/icons/LoadingIcon.vue';
import FileIcon from '@/icons/FileIcon.vue';
import { formatBytes, formatDate } from '@/utils';

const route = useRoute();
const router = useRouter();
const fileStore = useFileStore();

const loading = ref(true);

const viewMode = ref('list'); // 'list' | 'grid'
const sortBy = ref('name'); // 'name' | 'size' | 'dateModified'
const sortOrder = ref('asc'); // 'asc' | 'desc'

const rawItems = computed(() => fileStore.currentPathItems);

const sortedItems = computed(() => {
  const list = Array.isArray(rawItems.value) ? [...rawItems.value] : [];
  if (list.length === 0) return list;

  const direction = sortOrder.value === 'asc' ? 1 : -1;
  const key = sortBy.value;

  return list.sort((a, b) => {
    // Directories first
    if (a.kind === 'directory' && b.kind !== 'directory') return -1;
    if (a.kind !== 'directory' && b.kind === 'directory') return 1;

    const aVal = a[key];
    const bVal = b[key];
    if (aVal === bVal) return 0;
    return aVal > bVal ? direction : -direction;
  });
});

const currentInner = computed(() => {
  const rawPath = route.params.path;
  return Array.isArray(rawPath) ? rawPath.join('/') : (rawPath || '');
});

const selectedKeys = ref([]);

const keyForItem = (item) => {
  if (!item || !item.name) return '';
  const base = currentInner.value ? `${currentInner.value}/` : '';
  return `${base}${item.name}`;
};

const isSelected = (item) => {
  const key = keyForItem(item);
  return selectedKeys.value.includes(key);
};

const toggleSelection = (item) => {
  const key = keyForItem(item);
  if (!key) return;
  const idx = selectedKeys.value.indexOf(key);
  if (idx === -1) {
    selectedKeys.value = [...selectedKeys.value, key];
  } else {
    const next = [...selectedKeys.value];
    next.splice(idx, 1);
    selectedKeys.value = next;
  }
};

const selectRange = (item) => {
  if (!item) return;

  const items = Array.isArray(sortedItems.value) ? sortedItems.value : [];
  if (items.length === 0) return;

  const targetKey = keyForItem(item);
  if (!targetKey) return;

  const endIndex = items.findIndex((entry) => keyForItem(entry) === targetKey);
  if (endIndex === -1) return;

  const anchorKey = selectedKeys.value[selectedKeys.value.length - 1] || targetKey;
  const startIndex = items.findIndex((entry) => keyForItem(entry) === anchorKey);

  if (startIndex === -1) {
    selectedKeys.value = [targetKey];
    return;
  }

  const [start, end] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
  const keysInRange = items.slice(start, end + 1)
    .map((entry) => keyForItem(entry))
    .filter(Boolean);

  selectedKeys.value = keysInRange;
};

const clearSelection = () => {
  selectedKeys.value = [];
};

const selectedItems = computed(() => sortedItems.value.filter((item) => isSelected(item)));
const hasSelection = computed(() => selectedItems.value.length > 0);

const buildLogicalPath = () => {
  const shareId = typeof route.params.shareId === 'string' ? route.params.shareId : '';
  const rawPath = route.params.path;
  const inner = Array.isArray(rawPath) ? rawPath.join('/') : (rawPath || '');
  return ['share', shareId, inner].filter(Boolean).join('/');
};

const loadFiles = async () => {
  loading.value = true;
  const logicalPath = buildLogicalPath();
  try {
    await fileStore.fetchPathItems(logicalPath);
  } catch (error) {
    console.error('Failed to load shared directory contents', error);
  } finally {
    loading.value = false;
    clearSelection();
  }
};

onMounted(loadFiles);
watch(
  () => route.fullPath,
  () => {
    loadFiles();
  },
);

const handleOpen = (item) => {
  if (!item || !item.name) return;
  if (item.kind === 'directory') {
    const inner = currentInner.value;
    const nextInner = inner ? `${inner}/${item.name}` : item.name;
    router.push({ path: `/share/${route.params.shareId}/${nextInner}` });
  }
  // For public shares we do not open files (no preview / editor) yet.
};

const handleDownloadSelected = () => {
  if (!hasSelection.value) return;
  const shareId = typeof route.params.shareId === 'string' ? route.params.shareId : '';
  if (!shareId) return;

  const innerBase = currentInner.value;

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = `/api/share/${encodeURIComponent(shareId)}/download`;
  form.style.display = 'none';

  selectedItems.value.forEach((item) => {
    const innerPath = innerBase ? `${innerBase}/${item.name}` : item.name;
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'paths';
    input.value = innerPath;
    form.appendChild(input);
  });

  const basePathInput = document.createElement('input');
  basePathInput.type = 'hidden';
  basePathInput.name = 'basePath';
  basePathInput.value = innerBase;
  form.appendChild(basePathInput);

  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
};

const handleItemClick = (event, item) => {
  if (!item) return;
  const key = keyForItem(item);
  if (!key) return;

  if (event?.shiftKey && selectedKeys.value.length > 0) {
    selectRange(item);
    return;
  }

  if (event?.ctrlKey || event?.metaKey) {
    // Toggle selection while preserving existing selection
    toggleSelection(item);
    return;
  }

  // Single selection: replace current selection with this item
  selectedKeys.value = [key];
};

const handleItemDblClick = (item) => {
  handleOpen(item);
};
</script>

<template>
  <div class="h-full flex flex-col">
    <div
      v-if="loading"
      class="flex grow items-center justify-center text-sm text-neutral-500 dark:text-neutral-400"
    >
      <div class="flex items-center pr-4 bg-neutral-300 dark:bg-black bg-opacity-20 rounded-lg">
        <LoadingIcon /> <span class="ml-2">Loading…</span>
      </div>
    </div>

    <div v-else class="p-4">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2 text-xs">
          <button
            type="button"
            class="px-2 py-1 rounded-md border text-xs"
            :class="viewMode === 'list'
              ? 'bg-neutral-200 dark:bg-neutral-700 border-neutral-300 dark:border-neutral-600'
              : 'border-neutral-200 dark:border-neutral-700'"
            @click="viewMode = 'list'"
          >
            List
          </button>
          <button
            type="button"
            class="px-2 py-1 rounded-md border text-xs"
            :class="viewMode === 'grid'
              ? 'bg-neutral-200 dark:bg-neutral-700 border-neutral-300 dark:border-neutral-600'
              : 'border-neutral-200 dark:border-neutral-700'"
            @click="viewMode = 'grid'"
          >
            Grid
          </button>
        </div>

        <div class="flex items-center gap-2 text-xs">
          <label class="text-neutral-500 dark:text-neutral-400">Sort by</label>
          <select
            v-model="sortBy"
            class="rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-xs"
          >
            <option value="name">Name</option>
            <option value="size">Size</option>
            <option value="dateModified">Modified</option>
          </select>
          <button
            type="button"
            class="px-2 py-1 rounded-md border border-neutral-200 dark:border-neutral-700 text-xs"
            @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'"
          >
            {{ sortOrder === 'asc' ? '↑' : '↓' }}
          </button>
          <button
            type="button"
            class="ml-4 px-3 py-1.5 rounded-md text-xs font-medium bg-blue-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            @click="handleDownloadSelected"
            :disabled="!hasSelection"
          >
            Download
          </button>
        </div>
      </div>
      <div
        v-if="sortedItems.length === 0"
        class="text-sm text-neutral-500 dark:text-neutral-400 text-center mt-16"
      >
        This shared folder is empty.
      </div>

      <div v-else class="space-y-1">
        <div
          v-if="viewMode === 'list'"
          class="grid items-center px-4 py-2 text-xs text-neutral-600 dark:text-neutral-300 uppercase tracking-wide select-none bg-white/80 dark:bg-base/80 backdrop-blur-sm sticky top-0 z-10"
          style="grid-template-columns: 30px minmax(0, 5fr) minmax(0, 1fr) minmax(0, 2fr);"
        >
          <div></div>
          <div>{{ $t('folder.name') }}</div>
          <div>{{ $t('folder.size') }}</div>
          <div>{{ $t('folder.dateModified') }}</div>
        </div>

        <div v-if="viewMode === 'list'" class="flex flex-col gap-0.5">
          <div
            v-for="item in sortedItems"
            :key="item.name"
            class="grid select-none items-center cursor-pointer auto-cols-fr p-1 px-4 rounded-md transition-colors"
            @click="handleItemClick($event, item)"
            @dblclick="handleItemDblClick(item)"
            :class="[
              'even:bg-zinc-50 dark:even:bg-neutral-800/40',
              isSelected(item)
                ? 'text-white dark:text-white bg-blue-500! dark:bg-blue-600/80'
                : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
            ]"
            style="grid-template-columns: 30px minmax(0, 5fr) minmax(0, 1fr) minmax(0, 2fr);"
          >
            <FileIcon :item="item" :disable-thumbnails="true" class="w-5 h-5 flex-shrink-0" />
            <div class="break-all text-sm line-clamp-1">
              {{ item.name }}
            </div>
            <div class="text-sm">
              <span v-if="item.kind === 'directory'">—</span>
              <span v-else>{{ formatBytes(item.size) }}</span>
            </div>
            <div class="text-sm">
              {{ formatDate(item.dateModified) }}
            </div>
          </div>
        </div>

        <div v-else class="grid gap-3 grid-cols-[repeat(auto-fill,minmax(180px,1fr))] mt-3">
          <div
            v-for="item in sortedItems"
            :key="item.name"
            class="flex flex-col items-center gap-2 p-4 rounded-md border border-neutral-100 dark:border-neutral-800 cursor-pointer select-none transition-colors"
            @click="handleItemClick($event, item)"
            @dblclick="handleItemDblClick(item)"
            :class="[
              isSelected(item)
                ? 'ring-2 ring-blue-500 dark:ring-blue-400 bg-neutral-50 dark:bg-neutral-900'
                : 'hover:bg-neutral-50 dark:hover:bg-neutral-900'
            ]"
          >
            <FileIcon
              :item="item"
              :disable-thumbnails="true"
              class="h-16 w-16 flex-shrink-0"
            />
            <span
              class="text-xs text-center break-all line-clamp-2 rounded-md px-2 -mx-2"
              :class="{
                'bg-blue-500 text-white dark:bg-blue-600': isSelected(item),
              }"
            >
              {{ item.name }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
