<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { fetchSharesWithMe } from '@/api';
import { formatDate } from '@/utils';

const router = useRouter();

const loading = ref(true);
const shares = ref([]);

const loadShares = async () => {
  loading.value = true;
  try {
    shares.value = await fetchSharesWithMe();
  } catch (error) {
    console.error('Failed to load shares with me', error);
  } finally {
    loading.value = false;
  }
};

onMounted(loadShares);

const openShare = (share) => {
  if (!share?.id) return;
  router.push({ path: `/share/${share.id}` });
};
</script>

<template>
  <div class="p-4">
    <h1 class="text-lg font-semibold mb-4">Shared with me</h1>

    <div v-if="loading" class="text-sm text-neutral-500 dark:text-neutral-400">
      Loading…
    </div>

    <div v-else-if="shares.length === 0" class="text-sm text-neutral-500 dark:text-neutral-400">
      Nothing has been shared with you yet.
    </div>

    <div v-else class="space-y-2">
      <div
        class="grid items-center px-3 py-2 text-xs text-neutral-600 dark:text-neutral-300 uppercase tracking-wide select-none bg-white/70 dark:bg-base/70 backdrop-blur-sm sticky top-0 z-10"
        style="grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr);"
      >
        <div>Item</div>
        <div>Shared by</div>
        <div>Created</div>
      </div>

      <div class="divide-y divide-neutral-100 dark:divide-neutral-800">
        <button
          v-for="share in shares"
          :key="share.id"
          type="button"
          class="w-full grid items-center px-3 py-2 text-sm text-left hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
          style="grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr);"
          @click="openShare(share)"
        >
          <span class="truncate">{{ share.label || share.basePath }}</span>
          <span class="text-xs text-neutral-500 dark:text-neutral-400">
            {{ share.ownerUserId || '—' }}
          </span>
          <span class="text-xs text-neutral-500 dark:text-neutral-400">
            {{ share.createdAt ? formatDate(share.createdAt) : '—' }}
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

