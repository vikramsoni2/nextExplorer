import { computed } from 'vue';
import { useFileStore } from '@/stores/fileStore';
import { useFeaturesStore } from '@/stores/features';
import { normalizePath } from '@/api';
import { buildDownloadAction, submitDownloadForm } from '@/utils/download';

function isEditableElement(el) {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable) return true;
  return false;
}

function resolveItemPath(item) {
  if (!item || !item.name) return '';
  const parent = normalizePath(item.path || '');
  const combined = parent ? `${parent}/${item.name}` : item.name;
  return normalizePath(combined);
}

export function useFileActions() {
  const fileStore = useFileStore();
  const featuresStore = useFeaturesStore();

  const selectedItems = computed(() => fileStore.selectedItems);
  const hasSelection = computed(() => fileStore.hasSelection);
  const isSingleItemSelected = computed(() => selectedItems.value.length === 1);
  const primaryItem = computed(() => selectedItems.value[0] ?? null);

  const canCut = computed(() => hasSelection.value);
  const canCopy = computed(() => hasSelection.value);
  const canPaste = computed(() => fileStore.hasClipboardItems);
  const canDelete = computed(() => hasSelection.value);
  const canRename = computed(() => isSingleItemSelected.value && (primaryItem.value?.kind !== 'volume'));

  const isCutActive = computed(() => fileStore.cutItems.length > 0);
  const isCopyActive = computed(() => fileStore.copiedItems.length > 0);

  const runCut = () => { if (canCut.value) fileStore.cut(); };
  const runCopy = () => { if (canCopy.value) fileStore.copy(); };
  const runPasteToDestination = async (destinationPath) => {
    if (!canPaste.value) return;
    const dest = typeof destinationPath === 'string' ? destinationPath : '';
    await fileStore.paste(dest || undefined);
  };
  const runPasteIntoCurrent = async () => runPasteToDestination('');

  const runRename = () => {
    if (!canRename.value || !primaryItem.value) return;
    fileStore.beginRename(primaryItem.value);
  };

  const deleteNow = async () => {
    if (!canDelete.value) return;
    await fileStore.del();
  };

  const runDownload = () => {
    if (!hasSelection.value) return;

    const paths = selectedItems.value
      .map((item) => {
        const parent = normalizePath(item.path || '');
        const combined = parent ? `${parent}/${item.name}` : item.name;
        return normalizePath(combined);
      })
      .filter(Boolean);

    if (!paths.length) return;

    const currentPath = normalizePath(fileStore.getCurrentPath || '');

    const action = buildDownloadAction('/api/download', featuresStore.downloadPublicUrl);
    const fields = [
      ...paths.map((path) => ({ name: 'paths', value: path })),
      { name: 'basePath', value: currentPath },
    ];
    submitDownloadForm(action, fields);
  };

  return {
    // state
    selectedItems,
    primaryItem,
    isSingleItemSelected,
    // guards
    hasSelection,
    canCut,
    canCopy,
    canPaste,
    canDelete,
    canRename,
    isCutActive,
    isCopyActive,
    // helpers
    resolveItemPath,
    isEditableElement,
    // actions
    runCut,
    runCopy,
    runPasteToDestination,
    runPasteIntoCurrent,
    runRename,
    deleteNow,
    runDownload,
  };
}
