import { ref, reactive } from 'vue';
import { defineStore } from 'pinia';
import { useDark, useStorage, useToggle } from '@vueuse/core';

/**
 * @typedef {import('@/types').SortOption} SortOption
 */

const STORAGE_KEY_VIEW = 'settings:view';

export const useSettingsStore = defineStore('settings', () => {
  /** @type {import('vue').Ref<'grid' | 'list' | 'tab'>} */
  const view = useStorage(STORAGE_KEY_VIEW, 'grid');

  const gridView = () => { view.value = 'grid'; };
  const listView = () => { view.value = 'list'; };
  const tabView = () => { view.value = 'tab'; };

  /** @type {import('vue').Ref<number>} */
  const terminalHeight = ref(10);

  const isDark = useDark({ disableTransition: false });
  const toggleDark = useToggle(isDark);

  /** @type {SortOption[]} */
  const sortOptions = reactive([
    { key: 1, name: 'Name A to Z', by: 'name', order: 'asc' },
    { key: 2, name: 'Name Z to A', by: 'name', order: 'desc' },
    { key: 3, name: 'Small to large', by: 'size', order: 'asc' },
    { key: 4, name: 'Large to small', by: 'size', order: 'desc' },
    { key: 5, name: 'Old to new', by: 'dateModified', order: 'asc' },
    { key: 6, name: 'New to old', by: 'dateModified', order: 'desc' },
  ]);

  /** @type {import('vue').Ref<SortOption>} */
  const sortBy = ref(sortOptions[0]);

  /**
   * Set the sorting preference, defaulting to the current option when not found.
   * @param {number} key
   */
  const setSortBy = (key) => {
    const selected = sortOptions.find((option) => option.key === key);
    if (selected) {
      sortBy.value = selected;
    }
  };

  return {
    view,
    gridView,
    listView,
    tabView,
    isDark,
    toggleDark,
    sortBy,
    setSortBy,
    sortOptions,
    terminalHeight,
  };
});
