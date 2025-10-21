import { normalizePath } from '@/api';
import { useFileStore } from '@/stores/fileStore';

/**
 * @typedef {import('@/types').FileItem} FileItem
 */

/**
 * Build a stable key used to compare file items.
 * @param {FileItem | null | undefined} item
 * @returns {string}
 */
const getItemKey = (item) => {
  if (!item || !item.name) return '';
  const parent = normalizePath(item.path || '');
  return `${parent}::${item.name}`;
};

/**
 * Helper composable that manages selection state within the file store.
 * @returns {{
 *  isSelected: (item: FileItem) => boolean,
 *  handleSelection: (item: FileItem, event?: MouseEvent | KeyboardEvent) => void,
 *  clearSelection: () => void
 * }}
 */
export function useSelection() {
  const fileStore = useFileStore();

  /**
   * Ensure the item reference is the same instance that exists in the current store list.
   * @param {FileItem} item
   * @returns {FileItem}
   */
  const findInCurrentItems = (item) => {
    const key = getItemKey(item);
    return fileStore.getCurrentPathItems.find((candidate) => getItemKey(candidate) === key) || item;
  };

  /**
   * Determine if an item is currently selected.
   * @param {FileItem} item
   * @returns {boolean}
   */
  const isSelected = (item) => fileStore.selectedItems
    .some((selected) => getItemKey(selected) === getItemKey(item));

  /**
   * Toggle the selection state for a single item.
   * @param {FileItem} item
   */
  const toggleSelection = (item) => {
    const key = getItemKey(item);
    const index = fileStore.selectedItems.findIndex((selected) => getItemKey(selected) === key);

    if (index === -1) {
      const resolved = findInCurrentItems(item);
      fileStore.selectedItems = [...fileStore.selectedItems, resolved];
    } else {
      const nextSelection = [...fileStore.selectedItems];
      nextSelection.splice(index, 1);
      fileStore.selectedItems = nextSelection;
    }
  };

  /**
   * Select a range of items between the last selected element and the target.
   * @param {FileItem} item
   */
  const selectRange = (item) => {
    const currentItems = fileStore.getCurrentPathItems;
    const targetKey = getItemKey(item);
    const endIndex = currentItems.findIndex((entry) => getItemKey(entry) === targetKey);

    if (endIndex === -1) {
      return;
    }

    const anchor = fileStore.selectedItems[fileStore.selectedItems.length - 1] || item;
    const anchorKey = getItemKey(anchor);
    const startIndex = currentItems.findIndex((entry) => getItemKey(entry) === anchorKey);

    if (startIndex === -1) {
      fileStore.selectedItems = [currentItems[endIndex]];
      return;
    }

    const [start, end] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
    fileStore.selectedItems = currentItems.slice(start, end + 1);
  };

  /**
   * Clear all current selections.
   */
  const clearSelection = () => {
    fileStore.selectedItems = [];
  };

  /**
   * Handle pointer/keyboard selection modifiers for an item.
   * @param {FileItem} item
   * @param {MouseEvent | KeyboardEvent | PointerEvent} [event]
   */
  const handleSelection = (item, event) => {
    if (event?.ctrlKey || event?.metaKey) {
      toggleSelection(item);
    } else if (event?.shiftKey && fileStore.selectedItems.length > 0) {
      selectRange(item);
    } else {
      clearSelection();
      toggleSelection(item);
    }
  };

  return {
    isSelected,
    handleSelection,
    clearSelection,
  };
}
