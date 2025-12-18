<script setup>
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { getTrashItems, restoreTrashItem } from '@/api';
import { useNotificationsStore } from '@/stores/notifications';

const { t } = useI18n();
const notifications = useNotificationsStore();

const items = ref([]);
const isLoading = ref(false);
const restoringId = ref(null);

const formatDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const load = async () => {
  isLoading.value = true;
  try {
    const data = await getTrashItems();
    items.value = Array.isArray(data?.items) ? data.items : [];
  } catch (error) {
    console.error('Failed to load trash items', error);
    notifications.addNotification({
      type: 'error',
      heading: t('common.trash'),
      body: t('trash.loadFailed'),
    });
  } finally {
    isLoading.value = false;
  }
};

const handleRestore = async (item) => {
  if (!item?.id || restoringId.value) return;
  restoringId.value = item.id;
  try {
    const response = await restoreTrashItem(item.id);
    const restoredPath = response?.restored?.restoredPath;
    notifications.addNotification({
      type: 'success',
      heading: t('common.restore'),
      body: restoredPath
        ? t('trash.restoredTo', { path: restoredPath })
        : t('trash.restored'),
    });
    await load();
  } catch (error) {
    console.error('Restore failed', error);
    notifications.addNotification({
      type: 'error',
      heading: t('common.restore'),
      body: t('trash.restoreFailed'),
    });
  } finally {
    restoringId.value = null;
  }
};

onMounted(load);
</script>

<template>
  <div class="p-6">
    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
        {{ t('common.trash') }}
      </h1>
      <button
        type="button"
        class="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 active:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:active:bg-zinc-600"
        @click="load"
        :disabled="isLoading"
      >
        {{ isLoading ? t('common.loadingEllipsis') : t('common.refresh') }}
      </button>
    </div>

    <div v-if="items.length === 0" class="rounded-xl border border-zinc-200 bg-white p-6 text-zinc-600 dark:border-zinc-700 dark:bg-neutral-900 dark:text-zinc-300">
      <p class="text-sm">{{ t('trash.empty') }}</p>
    </div>

    <div v-else class="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-neutral-900">
      <table class="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-700">
        <thead class="bg-zinc-50 dark:bg-neutral-800">
          <tr>
            <th class="px-4 py-3 text-left font-medium text-zinc-700 dark:text-zinc-200">
              {{ t('common.name') }}
            </th>
            <th class="px-4 py-3 text-left font-medium text-zinc-700 dark:text-zinc-200">
              {{ t('common.location') }}
            </th>
            <th class="px-4 py-3 text-left font-medium text-zinc-700 dark:text-zinc-200">
              {{ t('trash.deletedAt') }}
            </th>
            <th class="px-4 py-3 text-right font-medium text-zinc-700 dark:text-zinc-200">
              {{ t('common.actions') }}
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-zinc-200 dark:divide-zinc-700">
          <tr v-for="item in items" :key="item.id">
            <td class="px-4 py-3 text-zinc-900 dark:text-zinc-100">
              {{ item.name }}
            </td>
            <td class="px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-300">
              {{ item.originalPath }}
            </td>
            <td class="px-4 py-3 text-zinc-600 dark:text-zinc-300">
              {{ formatDate(item.deletedAt) }}
            </td>
            <td class="px-4 py-3 text-right">
              <button
                type="button"
                class="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                @click="handleRestore(item)"
                :disabled="Boolean(restoringId) || isLoading"
              >
                <span v-if="restoringId === item.id">{{ t('trash.restoring') }}</span>
                <span v-else>{{ t('common.restore') }}</span>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

