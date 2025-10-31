<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue';
import {
  ArrowDownTrayIcon,
  DocumentDuplicateIcon,
  InformationCircleIcon,
  PencilSquareIcon,
  ScissorsIcon,
  TrashIcon,
  ClipboardDocumentCheckIcon,
} from '@heroicons/vue/24/outline';
import {
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
} from '@floating-ui/vue';
import { useContextMenuStore } from '@/stores/contextMenu';
import { useFileStore } from '@/stores/fileStore';
import { downloadItems, normalizePath } from '@/api';

const contextMenuStore = useContextMenuStore();
const fileStore = useFileStore();

const isOpen = computed(() => contextMenuStore.isOpen);
const position = computed(() => contextMenuStore.position);
const selectedItems = computed(() => fileStore.selectedItems);
const hasSelection = computed(() => fileStore.hasSelection);
const canRename = computed(() => {
  if (selectedItems.value.length !== 1) {
    return false;
  }
  const target = selectedItems.value[0];
  return target && target.kind !== 'volume';
});
const canPaste = computed(() => fileStore.hasClipboardItems);
const floatingRef = ref(null);
const referenceRef = shallowRef(null);
const isProcessingDownload = ref(false);
const pointerDownOptions = { capture: true };

const { floatingStyles, update } = useFloating(referenceRef, floatingRef, {
  placement: 'right-start',
  middleware: [
    offset(6),
    flip(),
    shift({ padding: 12 }),
  ],
  whileElementsMounted: autoUpdate,
});

const closeMenu = () => {
  contextMenuStore.close();
};

const createVirtualReference = ({ x, y }) => ({
  getBoundingClientRect: () => ({
    width: 0,
    height: 0,
    x,
    y,
    top: y,
    bottom: y,
    left: x,
    right: x,
  }),
});

const pointerDownHandler = (event) => {
  const menuEl = floatingRef.value;
  if (!menuEl) return;
  if (!menuEl.contains(event.target)) {
    closeMenu();
  }
};

const escapeHandler = (event) => {
  if (event.key === 'Escape') {
    closeMenu();
  }
};

const forceUpdate = () => {
  if (!isOpen.value) return;
  update();
};

const dispatchDeleteConfirm = () => {
  window.dispatchEvent(new CustomEvent('file-actions:open-delete-confirm'));
};

const extractFilename = (contentDisposition) => {
  if (!contentDisposition) return null;

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match && utf8Match[1]) {
    try {
      return decodeURIComponent(utf8Match[1].replace(/"/g, ''));
    } catch (error) {
      return utf8Match[1].replace(/"/g, '');
    }
  }

  const asciiMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  if (asciiMatch && asciiMatch[1]) {
    return asciiMatch[1];
  }

  return null;
};

const resolveSelectedPaths = () => selectedItems.value
  .map((item) => {
    const parent = normalizePath(item.path || '');
    const combined = parent ? `${parent}/${item.name}` : item.name;
    return normalizePath(combined);
  })
  .filter(Boolean);

const handleCut = () => {
  if (!hasSelection.value) return;
  fileStore.cut();
  closeMenu();
};

const handleCopy = () => {
  if (!hasSelection.value) return;
  fileStore.copy();
  closeMenu();
};

const handlePaste = async () => {
  if (!canPaste.value) return;
  try {
    await fileStore.paste();
  } catch (error) {
    console.error('Paste operation failed', error);
  } finally {
    closeMenu();
  }
};

const handleRename = () => {
  if (!canRename.value) return;
  const target = selectedItems.value[0];
  if (!target) return;
  fileStore.beginRename(target);
  closeMenu();
};

const handleDownload = async () => {
  if (!hasSelection.value || isProcessingDownload.value) return;

  const paths = resolveSelectedPaths();
  if (!paths.length) return;

  isProcessingDownload.value = true;
  try {
    const response = await downloadItems(paths, fileStore.getCurrentPath);
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition');

    const suggestedName = extractFilename(disposition)
      || (selectedItems.value.length === 1 && selectedItems.value[0]
        ? (
          selectedItems.value[0].kind === 'directory'
            ? `${selectedItems.value[0].name}.zip`
            : selectedItems.value[0].name
        )
        : (() => {
          const segments = (fileStore.getCurrentPath || '').split('/').filter(Boolean);
          const base = segments[segments.length - 1];
          return base ? `${base}.zip` : 'download.zip';
        })());

    const downloadUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.rel = 'noopener';
    anchor.download = suggestedName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(downloadUrl), 1000);
  } catch (error) {
    console.error('Download failed', error);
  } finally {
    isProcessingDownload.value = false;
    closeMenu();
  }
};

const handleDelete = () => {
  if (!hasSelection.value) return;
  closeMenu();
  dispatchDeleteConfirm();
};

watch(isOpen, (value) => {
  if (!value) {
    referenceRef.value = null;
    return;
  }
  const coords = position.value;
  if (!coords) return;
  const virtualRef = createVirtualReference(coords);
  referenceRef.value = virtualRef;
  nextTick(() => {
    update();
  });
});

watch(position, (coords) => {
  if (!isOpen.value || !coords) return;
  const virtualRef = createVirtualReference(coords);
  referenceRef.value = virtualRef;
  nextTick(() => {
    update();
  });
});

onMounted(() => {
  window.addEventListener('pointerdown', pointerDownHandler, pointerDownOptions);
  window.addEventListener('keydown', escapeHandler);
  window.addEventListener('resize', forceUpdate);
  window.addEventListener('scroll', forceUpdate, true);
});

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', pointerDownHandler, pointerDownOptions);
  window.removeEventListener('keydown', escapeHandler);
  window.removeEventListener('resize', forceUpdate);
  window.removeEventListener('scroll', forceUpdate, true);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="fixed inset-0 z-[1300]"
      @contextmenu.prevent
    >
      <div
        ref="floatingRef"
        class="absolute z-[1301] w-64 rounded-xl border border-white/10 bg-white/70 text-zinc-800 shadow-2xl backdrop-blur-xl transition-opacity dark:border-white/5 dark:bg-black/40 dark:text-zinc-200"
        :style="floatingStyles"
      >
        <div class="flex flex-col gap-1 p-2">
          <button
            type="button"
            class="flex h-8 w-full items-center gap-3 rounded-md px-3 py-1.5 text-left transition-colors hover:bg-sky-500/15 dark:hover:bg-sky-500/25"
            @click="closeMenu"
          >
            <InformationCircleIcon class="h-4 w-4" />
            <span class="flex-1 text-sm font-medium">Get Info</span>
          </button>

          <div class="my-1 h-px bg-zinc-300/50 dark:bg-zinc-700/50"></div>

          <button
            type="button"
            class="flex h-8 w-full items-center gap-3 rounded-md px-3 py-1.5 text-left transition-colors hover:bg-sky-500/15 dark:hover:bg-sky-500/25"
            :class="{
              'opacity-50 cursor-not-allowed': !hasSelection,
            }"
            :disabled="!hasSelection"
            @click="handleCut"
          >
            <ScissorsIcon class="h-4 w-4" />
            <span class="flex-1 text-sm font-medium">Cut</span>
            <span class="text-xs text-zinc-500 dark:text-zinc-400">⌘X</span>
          </button>

          <button
            type="button"
            class="flex h-8 w-full items-center gap-3 rounded-md px-3 py-1.5 text-left transition-colors hover:bg-sky-500/15 dark:hover:bg-sky-500/25"
            :class="{
              'opacity-50 cursor-not-allowed': !hasSelection,
            }"
            :disabled="!hasSelection"
            @click="handleCopy"
          >
            <DocumentDuplicateIcon class="h-4 w-4" />
            <span class="flex-1 text-sm font-medium">Copy</span>
            <span class="text-xs text-zinc-500 dark:text-zinc-400">⌘C</span>
          </button>

          <button
            type="button"
            class="flex h-8 w-full items-center gap-3 rounded-md px-3 py-1.5 text-left transition-colors hover:bg-sky-500/15 dark:hover:bg-sky-500/25"
            :class="{
              'opacity-50 cursor-not-allowed': !canPaste,
            }"
            :disabled="!canPaste"
            @click="handlePaste"
          >
            <ClipboardDocumentCheckIcon class="h-4 w-4" />
            <span class="flex-1 text-sm font-medium">Paste</span>
            <span class="text-xs text-zinc-500 dark:text-zinc-400">⌘V</span>
          </button>

          <div class="my-1 h-px bg-zinc-300/50 dark:bg-zinc-700/50"></div>

          <button
            type="button"
            class="flex h-8 w-full items-center gap-3 rounded-md px-3 py-1.5 text-left transition-colors hover:bg-sky-500/15 dark:hover:bg-sky-500/25"
            :class="{
              'opacity-50 cursor-not-allowed': !canRename,
            }"
            :disabled="!canRename"
            @click="handleRename"
          >
            <PencilSquareIcon class="h-4 w-4" />
            <span class="flex-1 text-sm font-medium">Rename</span>
          </button>

          <button
            type="button"
            class="flex h-8 w-full items-center gap-3 rounded-md px-3 py-1.5 text-left transition-colors hover:bg-sky-500/15 dark:hover:bg-sky-500/25"
            :class="{
              'opacity-50 cursor-not-allowed': !hasSelection || isProcessingDownload,
            }"
            :disabled="!hasSelection || isProcessingDownload"
            @click="handleDownload"
          >
            <ArrowDownTrayIcon class="h-4 w-4" />
            <span class="flex-1 text-sm font-medium">
              {{ isProcessingDownload ? 'Preparing…' : 'Download' }}
            </span>
          </button>

          <div class="my-1 h-px bg-zinc-300/50 dark:bg-zinc-700/50"></div>

          <button
            type="button"
            class="flex h-8 w-full items-center gap-3 rounded-md px-3 py-1.5 text-left text-red-600 transition-colors hover:bg-red-500/20 dark:text-red-500 dark:hover:bg-red-500/20"
            :class="{
              'opacity-50 cursor-not-allowed text-red-400 dark:text-red-400/70': !hasSelection,
            }"
            :disabled="!hasSelection"
            @click="handleDelete"
          >
            <TrashIcon class="h-4 w-4" />
            <span class="flex-1 text-sm font-medium">Delete</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
