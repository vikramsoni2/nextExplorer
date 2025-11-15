<script setup>
import { onMounted, ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { listTrash, restoreTrashItems, deleteTrashItems } from '@/api';
import { formatBytes, formatDate } from '@/utils';

const { t } = useI18n();

const items = ref([]);
const loading = ref(true);
const error = ref('');
const selectedIds = ref([]);
const restoring = ref(false);
const deleting = ref(false);

const hasSelection = computed(() => selectedIds.value.length > 0);

const loadTrash = async () => {
  loading.value = true;
  error.value = '';
  try {
    const response = await listTrash();
    items.value = Array.isArray(response?.items) ? response.items : [];
    selectedIds.value = [];
  } catch (err) {
    console.error('Failed to load trash items', err);
    error.value = err?.message || 'Failed to load trash items.';
  } finally {
    loading.value = false;
  }
};

onMounted(loadTrash);

const isSelected = (id) => selectedIds.value.includes(id);

const toggleSelection = (id) => {
  if (!id) return;
  const idx = selectedIds.value.indexOf(id);
  if (idx === -1) {
    selectedIds.value = [...selectedIds.value, id];
  } else {
    selectedIds.value = selectedIds.value.filter((x) => x !== id);
  }
};

const selectAll = () => {
  if (!items.value.length) return;
  if (selectedIds.value.length === items.value.length) {
    selectedIds.value = [];
  } else {
    selectedIds.value = items.value.map((item) => item.id);
  }
};

const restoreSelected = async () => {
  if (!hasSelection.value || restoring.value) return;
  restoring.value = true;
  try {
    await restoreTrashItems(selectedIds.value);
    await loadTrash();
  } catch (err) {
    console.error('Failed to restore trash items', err);
    // Keep selection so user can retry
  } finally {
    restoring.value = false;
  }
};

const deleteSelected = async () => {
  if (!hasSelection.value || deleting.value) return;
  // eslint-disable-next-line no-alert
  const confirmed = window.confirm(t('trash.confirmDeletePermanent'));
  if (!confirmed) return;

  deleting.value = true;
  try {
    await deleteTrashItems(selectedIds.value);
    await loadTrash();
  } catch (err) {
    console.error('Failed to permanently delete trash items', err);
  } finally {
    deleting.value = false;
  }
};
</script>

<template>
  <div class="flex flex-col gap-4">
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
          {{ t('trash.title') }}
        </h1>
        <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          {{ t('trash.subtitle') }}
        </p>
      </div>
      <div class="flex gap-2">
        <button
          type="button"
          class="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700"
          :disabled="!hasSelection || restoring || deleting"
          @click="restoreSelected"
        >
          <span v-if="restoring">{{ t('trash.restoring') }}</span>
          <span v-else>{{ t('trash.restoreSelected') }}</span>
        </button>
        <button
          type="button"
          class="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-red-500 dark:hover:bg-red-400"
          :disabled="!hasSelection || deleting"
          @click="deleteSelected"
        >
          <span v-if="deleting">{{ t('trash.deleting') }}</span>
          <span v-else>{{ t('trash.deleteSelected') }}</span>
        </button>
      </div>
    </header>

    <div v-if="loading" class="flex items-center justify-center py-10 text-sm text-neutral-500 dark:text-neutral-300">
      {{ t('trash.loading') }}
    </div>

    <div v-else-if="error" class="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/40 dark:text-red-200">
      {{ error }}
    </div>

    <div v-else-if="!items.length" class="rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-4 py-6 text-sm text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900/40 dark:text-neutral-300">
      {{ t('trash.empty') }}
    </div>

    <div
      v-else
      class="overflow-x-auto rounded-md border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900/60"
    >
      <table class="min-w-full text-left text-sm">
        <thead class="border-b border-neutral-200 bg-neutral-50 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
          <tr>
            <th class="w-8 px-3 py-2">
              <input
                type="checkbox"
                :checked="selectedIds.length === items.length && items.length > 0"
                @change="selectAll"
              >
            </th>
            <th class="px-3 py-2">
              {{ t('trash.name') }}
            </th>
            <th class="px-3 py-2">
              {{ t('trash.originalLocation') }}
            </th>
            <th class="px-3 py-2">
              {{ t('trash.volume') }}
            </th>
            <th class="px-3 py-2">
              {{ t('trash.size') }}
            </th>
            <th class="px-3 py-2">
              {{ t('trash.deletedAt') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in items"
            :key="item.id"
            class="border-t border-neutral-200 text-neutral-800 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-800/70"
            :class="{ 'bg-blue-50/70 dark:bg-blue-900/40': isSelected(item.id) }"
            @click="toggleSelection(item.id)"
          >
            <td class="px-3 py-2">
              <input
                type="checkbox"
                :checked="isSelected(item.id)"
                @click.stop="toggleSelection(item.id)"
              >
            </td>
            <td class="max-w-xs truncate px-3 py-2">
              {{ item.name }}
            </td>
            <td class="max-w-md truncate px-3 py-2 text-neutral-600 dark:text-neutral-300">
              {{ item.originalRelativePath }}
            </td>
            <td class="px-3 py-2 text-neutral-600 dark:text-neutral-300">
              {{ item.volume }}
            </td>
            <td class="px-3 py-2 text-neutral-600 dark:text-neutral-300">
              <span v-if="item.kind === 'directory'">
                —
              </span>
              <span v-else>
                {{ formatBytes(item.size) }}
              </span>
            </td>
            <td class="px-3 py-2 text-neutral-600 dark:text-neutral-300">
              <span v-if="item.deletedAt">
                {{ formatDate(item.deletedAt) }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

