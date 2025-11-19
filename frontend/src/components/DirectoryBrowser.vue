<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { requestJson } from '@/api/http';

const { t } = useI18n();
const emit = defineEmits(['close', 'select']);

const currentPath = ref('/mnt');
const directories = ref([]);
const loading = ref(false);
const errorMsg = ref('');
const selectedPath = ref('');
const selectedName = ref('');

// Load directories at current path
const loadDirectories = async (path) => {
  loading.value = true;
  errorMsg.value = '';

  try {
    // Fetch directory contents
    const relativePath = path.replace(/^\/mnt\/?/, '');
    const response = await requestJson(`/api/browse/${relativePath}`, {
      method: 'GET'
    });

    // Filter to only show directories
    const items = response?.items || [];
    directories.value = items.filter(item => item.kind === 'directory');
  } catch (e) {
    errorMsg.value = e?.message || 'Failed to load directories';
    directories.value = [];
  } finally {
    loading.value = false;
  }
};

// Navigate to a directory
const navigateTo = async (dir) => {
  const newPath = currentPath.value === '/'
    ? `/${dir.name}`
    : `${currentPath.value}/${dir.name}`;

  currentPath.value = newPath;
  await loadDirectories(newPath);
};

// Go up one level
const goUp = async () => {
  const parts = currentPath.value.split('/').filter(Boolean);

  if (parts.length <= 1) {
    // Already at /mnt, can't go higher
    return;
  }

  parts.pop();
  const newPath = '/' + parts.join('/');
  currentPath.value = newPath;
  await loadDirectories(newPath);
};

// Select current path
const selectCurrentPath = () => {
  if (!selectedName.value.trim()) {
    alert('Please enter a name for this volume');
    return;
  }

  emit('select', {
    path: currentPath.value,
    name: selectedName.value.trim()
  });
};

// Close modal
const close = () => {
  emit('close');
};

onMounted(() => {
  loadDirectories(currentPath.value);
  // Default name is the last part of the path
  const parts = currentPath.value.split('/').filter(Boolean);
  selectedName.value = parts[parts.length - 1] || 'Volume';
});
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
    role="dialog"
    aria-modal="true"
  >
    <div class="fixed inset-0 bg-black/50" @click="close"></div>
    <div class="relative z-10 w-full max-w-3xl overflow-hidden rounded-lg border border-white/10 bg-white/90 shadow-xl dark:border-white/10 dark:bg-zinc-900/90">
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-white/10 p-4">
        <h3 class="text-lg font-semibold">{{ t('settings.users.volumes.browserTitle') }}</h3>
        <button
          type="button"
          class="text-neutral-500 hover:text-neutral-300"
          :aria-label="t('common.dismiss')"
          @click="close"
        >
          &times;
        </button>
      </div>

      <!-- Current path and navigation -->
      <div class="border-b border-white/10 p-4">
        <div class="flex items-center gap-2 mb-3">
          <span class="text-sm text-gray-400">{{ t('settings.users.volumes.browsing') }}</span>
          <code class="flex-1 rounded bg-black/20 px-2 py-1 text-sm">{{ currentPath }}</code>
          <button
            v-if="currentPath !== '/mnt'"
            type="button"
            class="rounded-md border border-white/10 px-3 py-1 text-sm hover:bg-white/5"
            @click="goUp"
          >
            ↑ Up
          </button>
        </div>

        <!-- Name input -->
        <div>
          <label class="block text-xs uppercase tracking-wide text-neutral-400 mb-1">
            Volume Name
          </label>
          <input
            v-model="selectedName"
            type="text"
            placeholder="e.g., My Media, Documents, etc."
            class="w-full rounded-md border border-white/10 bg-transparent px-3 py-1.5"
          />
        </div>
      </div>

      <!-- Directory list -->
      <div class="max-h-96 overflow-y-auto p-4">
        <p v-if="errorMsg" class="text-sm text-red-500 mb-3">{{ errorMsg }}</p>
        <p v-if="loading" class="text-sm text-gray-400">{{ t('common.loading') }}…</p>

        <div v-else-if="directories.length === 0" class="text-center py-8 text-sm text-gray-400">
          No subdirectories found
        </div>

        <div v-else class="space-y-1">
          <button
            v-for="dir in directories"
            :key="dir.name"
            type="button"
            class="w-full flex items-center gap-3 rounded-md border border-white/10 bg-white/5 px-4 py-3 text-left hover:bg-white/10 transition-colors"
            @click="navigateTo(dir)"
          >
            <svg class="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <span class="flex-1">{{ dir.name }}</span>
            <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-end gap-2 border-t border-white/10 p-4">
        <button
          type="button"
          class="rounded-md border border-white/10 px-4 py-2 text-sm hover:bg-white/5"
          @click="close"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          type="button"
          class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-black hover:bg-accent/90"
          @click="selectCurrentPath"
        >
          {{ t('settings.users.volumes.selectPath') }}
        </button>
      </div>
    </div>
  </div>
</template>
