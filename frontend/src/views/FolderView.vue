<script setup>
import { ref, onMounted, computed, onBeforeUnmount, nextTick, watch } from 'vue';
import { useRoute } from 'vue-router';
import { normalizePath } from '@/api';
import { useSettingsStore } from '@/stores/settings';
import FileObject from '@/components/FileObject.vue';
import { useFileStore } from '@/stores/fileStore';
import { useFolderSizeStore } from '@/stores/folderSize';
import { useFeaturesStore } from '@/stores/features';
import LoadingIcon from '@/icons/LoadingIcon.vue';
import { useSelection } from '@/composables/itemSelection';
import { useExplorerContextMenu } from '@/composables/contextMenu';
import { isPreviewableImage, isPreviewableVideo } from '@/config/media';
import { ImagesOutline } from '@vicons/ionicons5';
import { useViewConfig } from '@/composables/useViewConfig';
import { DragSelect } from '@coleqiu/vue-drag-select';
import { useUppyDropTarget } from '@/composables/fileUploader';
import { FolderOpenIcon } from '@heroicons/vue/24/outline';
import {
  ChevronDoubleDownIcon,
  ChevronDoubleUpIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@heroicons/vue/20/solid';
import { useEventListener } from '@vueuse/core';
import { useInputMode } from '@/composables/useInputMode';
import { useFileDragDrop } from '@/composables/useFileDragDrop';

const settings = useSettingsStore();
const fileStore = useFileStore();
const folderSizeStore = useFolderSizeStore();
const featuresStore = useFeaturesStore();
const route = useRoute();
const { gridClasses, gridStyle } = useViewConfig();
const loading = ref(true);
const visibleLimit = ref(500);
const loadMoreTrigger = ref(null);
const isScrollable = ref(false);
const canScrollUp = ref(false);
const canScrollDown = ref(false);
const { clearSelection } = useSelection();
const contextMenu = useExplorerContextMenu();
const dropTargetRef = ref(null);
useUppyDropTarget(dropTargetRef);

const { isTouchDevice } = useInputMode();
const { handleDragOver, handleDragLeave, handleDrop, isDragTarget } = useFileDragDrop();

const INITIAL_VISIBLE_ITEMS = 500;
const VISIBLE_ITEMS_INCREMENT = 500;
const VIRTUAL_LIST_THRESHOLD = 1000;
const LIST_ROW_HEIGHT = 37;
const LIST_ROW_OVERSCAN = 20;
let loadMoreObserver = null;
const scrollTop = ref(0);
const scrollViewportHeight = ref(0);

const getScrollTarget = () => {
  const localTarget = dropTargetRef.value;
  if (localTarget && localTarget.scrollHeight - localTarget.clientHeight > 2) {
    return localTarget;
  }

  return document.scrollingElement || document.documentElement;
};

const applySelectionFromQuery = () => {
  const selectName = typeof route.query?.select === 'string' ? route.query.select : '';
  if (!selectName) return;
  const match = fileStore.getCurrentPathItems.find((it) => it?.name === selectName);
  if (match) {
    fileStore.selectedItems = [match];
  }
};

const sortedItems = computed(() => fileStore.getCurrentPathItems);
const useVirtualList = computed(
  () => settings.view === 'list' && sortedItems.value.length > VIRTUAL_LIST_THRESHOLD
);
const virtualStartIndex = computed(() => {
  if (!useVirtualList.value) return 0;
  return Math.max(0, Math.floor(scrollTop.value / LIST_ROW_HEIGHT) - LIST_ROW_OVERSCAN);
});
const virtualEndIndex = computed(() => {
  if (!useVirtualList.value) return visibleLimit.value;
  const visibleCount =
    Math.ceil(scrollViewportHeight.value / LIST_ROW_HEIGHT) + LIST_ROW_OVERSCAN * 2;
  return Math.min(sortedItems.value.length, virtualStartIndex.value + visibleCount);
});
const visibleItems = computed(() => {
  if (useVirtualList.value) {
    return sortedItems.value.slice(virtualStartIndex.value, virtualEndIndex.value);
  }
  return sortedItems.value.slice(0, visibleLimit.value);
});
const hasMoreItems = computed(
  () => !useVirtualList.value && visibleItems.value.length < sortedItems.value.length
);
const virtualTopSpacerHeight = computed(() =>
  useVirtualList.value ? virtualStartIndex.value * LIST_ROW_HEIGHT : 0
);
const virtualBottomSpacerHeight = computed(() =>
  useVirtualList.value
    ? Math.max(0, (sortedItems.value.length - virtualEndIndex.value) * LIST_ROW_HEIGHT)
    : 0
);

const getItemKey = (item) => {
  if (!item || !item.name) return '';
  const parent = normalizePath(item.path || '');
  return `${parent}::${item.name}`;
};

const allItemsSelected = computed(
  () =>
    sortedItems.value.length > 0 &&
    sortedItems.value.every((item) => fileStore.selectedItemKeys.has(getItemKey(item)))
);

const someItemsSelected = computed(
  () =>
    sortedItems.value.length > 0 &&
    sortedItems.value.some((item) => fileStore.selectedItemKeys.has(getItemKey(item)))
);

const resetVisibleItems = () => {
  visibleLimit.value = INITIAL_VISIBLE_ITEMS;
};

const revealMoreItems = () => {
  if (!hasMoreItems.value) return;
  visibleLimit.value = Math.min(
    sortedItems.value.length,
    visibleLimit.value + VISIBLE_ITEMS_INCREMENT
  );
  nextTick(updateScrollState);
};

const updateScrollState = () => {
  const target = getScrollTarget();
  if (!target) {
    isScrollable.value = false;
    canScrollUp.value = false;
    canScrollDown.value = false;
    return;
  }

  const maxScrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
  scrollTop.value = target.scrollTop;
  scrollViewportHeight.value = target.clientHeight;
  isScrollable.value = maxScrollTop > 2;
  canScrollUp.value = target.scrollTop > 2;
  canScrollDown.value = target.scrollTop < maxScrollTop - 2;
};

const revealAllItems = async () => {
  while (visibleLimit.value < sortedItems.value.length) {
    visibleLimit.value = Math.min(
      sortedItems.value.length,
      visibleLimit.value + VISIBLE_ITEMS_INCREMENT
    );
    await nextTick();
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
};

const scrollToTop = () => {
  getScrollTarget()?.scrollTo?.({ top: 0, behavior: useVirtualList.value ? 'auto' : 'smooth' });
};

const scrollToBottom = async () => {
  if (!useVirtualList.value) {
    await revealAllItems();
  }
  await nextTick();
  const target = getScrollTarget();
  target?.scrollTo?.({
    top: target.scrollHeight,
    behavior: useVirtualList.value ? 'auto' : 'smooth',
  });
  updateScrollState();
};

const toggleSelectAll = () => {
  if (allItemsSelected.value) {
    clearSelection();
    return;
  }

  fileStore.selectedItems = [...sortedItems.value];
};

const disconnectLoadMoreObserver = () => {
  if (loadMoreObserver) {
    loadMoreObserver.disconnect();
    loadMoreObserver = null;
  }
};

const setupLoadMoreObserver = async () => {
  disconnectLoadMoreObserver();

  if (!hasMoreItems.value || typeof IntersectionObserver === 'undefined') {
    return;
  }

  await nextTick();
  if (!loadMoreTrigger.value) {
    return;
  }

  loadMoreObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        revealMoreItems();
      }
    },
    { root: null, rootMargin: '800px 0px' }
  );
  loadMoreObserver.observe(loadMoreTrigger.value);
};

const selectionModel = computed({
  get: () => fileStore.selectedItems,
  set: (val) => {
    // val is the new selection from drag-select (array of items)
    // We update the store.
    // Note: drag-select might replace the selection.
    // If we want to support modifiers, the library handles 'multiple' prop.
    fileStore.selectedItems = val;
  },
});

const loadFiles = async () => {
  loading.value = true;
  resetVisibleItems();
  const path = route.params.path || '';
  try {
    await fileStore.fetchPathItems(path);
    applySelectionFromQuery();
  } catch (error) {
    console.error('Failed to load directory contents', error);
  } finally {
    loading.value = false;
    await setupLoadMoreObserver();
    await nextTick();
    updateScrollState();
  }
};

// Ask for the size of every folder currently on screen, in one request. Runs
// again whenever the listing changes, which is what makes a folder show its
// size the moment it appears rather than at the next pass.
const refreshFolderSizes = () => {
  if (!featuresStore.folderSizeEnabled) return;
  const dirPaths = fileStore.getCurrentPathItems
    .filter((item) => item?.kind === 'directory')
    .map((item) => (item.path ? `${item.path}/${item.name}` : item.name));
  if (dirPaths.length) folderSizeStore.ensureSizes(dirPaths).catch(() => {});
};

watch(() => fileStore.getCurrentPathItems, refreshFolderSizes, { immediate: true });

onMounted(loadFiles);

watch(hasMoreItems, () => {
  setupLoadMoreObserver();
  nextTick(updateScrollState);
});

watch(
  () => [visibleItems.value.length, sortedItems.value.length, settings.view, useVirtualList.value],
  () => {
    nextTick(updateScrollState);
  }
);

watch(
  () => route.params.path,
  () => {
    resetVisibleItems();
  }
);

const handleBackgroundContextMenu = (event) => {
  if (!contextMenu || !event) return;
  contextMenu?.openBackgroundMenu(event);
};

const showNoPhotosMessage = computed(() => {
  if (loading.value) return false;
  if (settings.view !== 'photos') return false;

  const items = fileStore.getCurrentPathItems;
  if (items.length === 0) return false;

  // Check if any item is an image or video
  const hasPhotos = items.some((item) => {
    const kind = (item?.kind || '').toLowerCase();
    return isPreviewableImage(kind) || isPreviewableVideo(kind);
  });

  return !hasPhotos;
});

const showEmptyFolderMessage = computed(() => {
  if (loading.value) return false;
  return fileStore.getCurrentPathItems.length === 0;
});

const toggleSort = (by, defaultOrder = 'asc') => {
  const currentBy = settings.sortBy?.by;
  const currentOrder = settings.sortBy?.order;

  if (currentBy === by) {
    settings.setSort(by, currentOrder === 'asc' ? 'desc' : 'asc');
    return;
  }

  settings.setSort(by, defaultOrder);
};

const listColumns = [
  {
    key: 'name',
    labelKey: 'common.name',
    by: 'name',
    defaultOrder: 'asc',
    widthIndex: 1,
  },
  {
    key: 'size',
    labelKey: 'common.size',
    by: 'size',
    defaultOrder: 'desc',
    widthIndex: 2,
  },
  {
    key: 'kind',
    labelKey: 'folder.kind',
    by: 'kind',
    defaultOrder: 'asc',
    widthIndex: 3,
  },
  {
    key: 'dateModified',
    labelKey: 'folder.dateModified',
    by: 'dateModified',
    defaultOrder: 'desc',
    widthIndex: 4,
  },
];

const sortIndicator = (by) => {
  if (settings.sortBy?.by !== by) return null;
  return settings.sortBy?.order || null;
};

const resizeState = ref(null);
const bodyStyleBeforeResize = ref({ cursor: '', userSelect: '' });

const stopResize = () => {
  if (!resizeState.value) return;
  resizeState.value = null;
  document.body.style.cursor = bodyStyleBeforeResize.value.cursor;
  document.body.style.userSelect = bodyStyleBeforeResize.value.userSelect;
};

const startResize = (colIndex, event) => {
  if (!event) return;
  if (event.button !== undefined && event.button !== 0) return;

  const startWidth = Number(settings.listViewColumnWidths?.[colIndex]);
  if (!Number.isFinite(startWidth)) return;

  resizeState.value = { colIndex, startX: event.clientX, startWidth };
  bodyStyleBeforeResize.value = {
    cursor: document.body.style.cursor || '',
    userSelect: document.body.style.userSelect || '',
  };
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
};

useEventListener(window, 'pointermove', (event) => {
  const state = resizeState.value;
  if (!state) return;
  const deltaX = event.clientX - state.startX;
  settings.setListViewColumnWidth(state.colIndex, state.startWidth + deltaX);
});

useEventListener(window, 'pointerup', stopResize);
useEventListener(window, 'pointercancel', stopResize);
useEventListener(window, 'resize', updateScrollState);
useEventListener(window, 'scroll', updateScrollState, { passive: true });

onBeforeUnmount(() => {
  stopResize();
  disconnectLoadMoreObserver();
});
</script>

<template>
  <div
    ref="dropTargetRef"
    class="upload-drop-target relative flex flex-col flex-1 min-h-0 overflow-y-auto"
    @click.self="clearSelection()"
    @scroll.passive="updateScrollState"
  >
    <template v-if="!loading">
      <DragSelect
        v-model="selectionModel"
        :click-option-to-select="false"
        :draggable-on-option="false"
        :disabled="isTouchDevice || !!fileStore.renameState"
        class="grow px-2"
        @click.self="clearSelection()"
        @contextmenu.prevent="handleBackgroundContextMenu"
      >
        <div
          :class="[gridClasses, 'min-h-full', settings.view === 'list' ? 'overflow-x-auto' : '']"
          :style="gridStyle"
        >
          <!-- Detail view header -->
          <div
            v-if="settings.view === 'list'"
            :class="[
              'grid items-center',
              'px-4 py-2 text-xs',
              'text-neutral-600 dark:text-neutral-300',
              'uppercase tracking-wide select-none',
              'bg-white dark:bg-default',
              'backdrop-blur-sm',
              'min-w-max',
            ]"
            :style="{
              gridTemplateColumns: settings.listViewGridTemplateColumns,
            }"
          >
            <div class="flex items-center justify-center">
              <input
                type="checkbox"
                class="h-4 w-4 rounded border-neutral-300 text-blue-600 focus:ring-blue-500"
                :checked="allItemsSelected"
                :indeterminate.prop="someItemsSelected && !allItemsSelected"
                :aria-label="allItemsSelected ? $t('folder.deselectAll') : $t('folder.selectAll')"
                @change="toggleSelectAll"
                @click.stop
              />
            </div>
            <div v-for="col in listColumns" :key="col.key" class="relative flex items-center">
              <button
                type="button"
                class="flex items-center gap-1 text-left hover:text-neutral-900 dark:hover:text-white"
                @click="toggleSort(col.by, col.defaultOrder)"
              >
                <span>{{ $t(col.labelKey) }}</span>
                <ChevronUpIcon v-if="sortIndicator(col.by) === 'asc'" class="h-3.5 w-3.5" />
                <ChevronDownIcon v-else-if="sortIndicator(col.by) === 'desc'" class="h-3.5 w-3.5" />
              </button>
              <div
                class="absolute -right-2 top-0 h-full w-4 cursor-col-resize touch-none"
                title="Resize"
                @pointerdown.stop.prevent="startResize(col.widthIndex, $event)"
                @dblclick.stop.prevent="settings.resetListViewColumnWidths()"
              >
                <div
                  class="mx-auto h-full w-px bg-transparent hover:bg-neutral-300 dark:hover:bg-neutral-600"
                ></div>
              </div>
            </div>
          </div>

          <div
            v-if="useVirtualList && virtualTopSpacerHeight > 0"
            class="shrink-0"
            :style="{ height: `${virtualTopSpacerHeight}px` }"
          ></div>

          <FileObject
            v-for="item in visibleItems"
            :key="(item.path || '') + '::' + item.name"
            :item="item"
            :view="settings.view"
            :class="[
              'relative',
              item.kind === 'directory' && isDragTarget(item)
                ? 'ring-2 ring-blue-500 dark:ring-blue-400 ring-offset-2 dark:ring-offset-zinc-800 rounded-lg'
                : '',
            ]"
            @dragover="(e) => item.kind === 'directory' && handleDragOver(e, item)"
            @dragleave="(e) => item.kind === 'directory' && handleDragLeave(e, item)"
            @drop="(e) => item.kind === 'directory' && handleDrop(e, item)"
          />

          <div
            v-if="useVirtualList && virtualBottomSpacerHeight > 0"
            class="shrink-0"
            :style="{ height: `${virtualBottomSpacerHeight}px` }"
          ></div>

          <div
            v-if="hasMoreItems"
            ref="loadMoreTrigger"
            class="flex items-center justify-center py-4 text-xs text-neutral-500 dark:text-neutral-400"
          >
            <button
              type="button"
              class="rounded-md border border-neutral-200 px-3 py-1.5 transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              @click="revealMoreItems"
            >
              {{ visibleItems.length }} / {{ sortedItems.length }} {{ $t('common.items') }}
            </button>
          </div>

          <!-- No photos message -->
          <div
            v-if="showNoPhotosMessage || showEmptyFolderMessage"
            class="absolute inset-0 flex flex-col items-center justify-center min-h-[400px] text-center px-4"
          >
            <div class="text-neutral-400 dark:text-neutral-500 mb-2">
              <FolderOpenIcon v-if="showEmptyFolderMessage" class="w-16 h-16 mb-4 opacity-30" />
              <ImagesOutline v-else class="w-20 h-20 mx-auto mb-4 opacity-50" />
            </div>
            <h3 class="text-lg font-medium text-neutral-700 dark:text-neutral-300 mb-2">
              {{ showEmptyFolderMessage ? $t('folder.empty') : $t('folder.noPhotos') }}
            </h3>
            <p class="text-sm text-neutral-500 dark:text-neutral-400">
              {{ showEmptyFolderMessage ? $t('folder.emptyHint') : $t('folder.noPhotosHint') }}
            </p>
          </div>
        </div>
      </DragSelect>

      <div
        v-if="isScrollable"
        class="pointer-events-none fixed bottom-6 right-6 z-[100] flex flex-col gap-2"
      >
        <button
          v-if="canScrollUp"
          type="button"
          class="pointer-events-auto grid h-10 w-10 place-items-center rounded-full border border-neutral-200 bg-white/90 text-neutral-700 shadow-lg backdrop-blur transition hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900/90 dark:text-neutral-100 dark:hover:bg-neutral-800"
          :aria-label="$t('folder.scrollTop')"
          :title="$t('folder.scrollTop')"
          @click="scrollToTop"
        >
          <ChevronDoubleUpIcon class="h-5 w-5" />
        </button>
        <button
          v-if="canScrollDown"
          type="button"
          class="pointer-events-auto grid h-10 w-10 place-items-center rounded-full border border-neutral-200 bg-white/90 text-neutral-700 shadow-lg backdrop-blur transition hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900/90 dark:text-neutral-100 dark:hover:bg-neutral-800"
          :aria-label="$t('folder.scrollBottom')"
          :title="$t('folder.scrollBottom')"
          @click="scrollToBottom"
        >
          <ChevronDoubleDownIcon class="h-5 w-5" />
        </button>
      </div>
    </template>

    <template v-else>
      <div
        class="flex flex-1 items-center justify-center text-sm text-neutral-600 dark:text-neutral-300"
      >
        <div class="flex items-center pr-4 bg-neutral-200 dark:bg-zinc-700/50 rounded-xl">
          <LoadingIcon /> {{ $t('common.loading') }}
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.upload-drop-target.uppy-is-drag-over {
  outline: 2px dashed rgba(59, 130, 246, 0.6);
  outline-offset: -2px;
}
</style>
