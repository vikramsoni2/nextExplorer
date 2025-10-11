import { ref } from 'vue';
import { defineStore } from 'pinia';
import { useDark, useStorage, useToggle } from '@vueuse/core';

type ViewMode = 'grid' | 'list' | 'tab';

interface SortOption {
  key: number;
  name: string;
  by: 'name' | 'size' | 'dateModified';
  order: 'asc' | 'desc';
}

const SORT_OPTIONS: SortOption[] = [
  { key: 1, name: 'Name A to Z', by: 'name', order: 'asc' },
  { key: 2, name: 'Name Z to A', by: 'name', order: 'desc' },
  { key: 3, name: 'Small to large', by: 'size', order: 'asc' },
  { key: 4, name: 'Large to small', by: 'size', order: 'desc' },
  { key: 5, name: 'Old to new', by: 'dateModified', order: 'asc' },
  { key: 6, name: 'New to old', by: 'dateModified', order: 'desc' },
];

const FALLBACK_SORT_OPTION: SortOption = SORT_OPTIONS[0]!;

export const useSettingsStore = defineStore('settings', () => {
  const view = useStorage<ViewMode>('settings:view', 'grid');
  const gridView = (): void => { view.value = 'grid'; };
  const listView = (): void => { view.value = 'list'; };
  const tabView = (): void => { view.value = 'tab'; };

  const terminalHeight = ref(10);

  const isDark = useDark({ disableTransition: false });
  const toggleDark = useToggle(isDark);

  const sortOptions = ref<SortOption[]>([...SORT_OPTIONS]);
  const sortBy = ref<SortOption>(sortOptions.value[0] ?? FALLBACK_SORT_OPTION);

  const setSortBy = (key: number): void => {
    const option = sortOptions.value.find((entry) => entry.key === key) ?? FALLBACK_SORT_OPTION;
    sortBy.value = option;
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
