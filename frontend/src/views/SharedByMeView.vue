<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { fetchSharesByMe, deleteShare as deleteShareApi } from '@/api';
import { formatDate } from '@/utils';

const router = useRouter();

const loading = ref(true);
const shares = ref([]);
const deletingIds = ref(new Set());

const loadShares = async () => {
  loading.value = true;
  try {
    shares.value = await fetchSharesByMe();
  } catch (error) {
    console.error('Failed to load shares by me', error);
  } finally {
    loading.value = false;
  }
};

onMounted(loadShares);

const openShare = (share) => {
  if (!share?.id) return;
  router.push({ path: `/share/${share.id}` });
};

const handleDelete = async (share) => {
  if (!share?.id) return;
  if (!window.confirm(`Stop sharing "${share.label || share.basePath}"?`)) {
    return;
  }

  const next = new Set(deletingIds.value);
  next.add(share.id);
  deletingIds.value = next;

  try {
    await deleteShareApi(share.id);
    await loadShares();
  } catch (error) {
    console.error('Failed to delete share', error);
  } finally {
    const updated = new Set(deletingIds.value);
    updated.delete(share.id);
    deletingIds.value = updated;
  }
};

const isDeleting = (shareId) => deletingIds.value.has(shareId);
</script>

<template>
  <div class="p-4">
    <h1 class="text-lg font-semibold mb-4">Shared by me</h1>

    <div v-if="loading" class="text-sm text-neutral-500 dark:text-neutral-400">
      Loading…
    </div>

    <div v-else-if="shares.length === 0" class="text-sm text-neutral-500 dark:text-neutral-400">
      You have not shared any items yet.
    </div>

    <div v-else class="space-y-2">
      <div
        class="grid items-center px-3 py-2 text-xs text-neutral-600 dark:text-neutral-300 uppercase tracking-wide select-none bg-white/70 dark:bg-base/70 backdrop-blur-sm sticky top-0 z-10"
        style="grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) auto;"
      >
        <div>Item</div>
        <div>Mode</div>
        <div>Created</div>
        <div>Expires</div>
        <div></div>
      </div>

      <div class="divide-y divide-neutral-100 dark:divide-neutral-800">
        <div
          v-for="share in shares"
          :key="share.id"
          class="grid items-center px-3 py-2 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
          style="grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) auto;"
        >
          <button
            type="button"
            class="truncate text-left"
            @click="openShare(share)"
          >
            {{ share.label || share.basePath }}
          </button>
          <div class="text-xs text-neutral-500 dark:text-neutral-400">
            {{ share.linkMode === 'rw' ? 'Can edit' : 'View only' }}
          </div>
          <div class="text-xs text-neutral-500 dark:text-neutral-400">
            {{ share.createdAt ? formatDate(share.createdAt) : '—' }}
          </div>
          <div class="text-xs text-neutral-500 dark:text-neutral-400">
            {{ share.linkExpiresAt ? formatDate(share.linkExpiresAt) : 'Never' }}
          </div>
          <div class="text-right">
            <button
              type="button"
              class="px-3 py-1 rounded-md text-xs border border-neutral-200 dark:border-neutral-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
              @click="handleDelete(share)"
              :disabled="isDeleting(share.id)"
            >
              {{ isDeleting(share.id) ? 'Removing…' : 'Remove' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

