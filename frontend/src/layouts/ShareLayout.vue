<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useTitle } from '@vueuse/core';

import HeaderLogo from '@/components/HeaderLogo.vue';
import ShareFolderView from '@/views/ShareFolderView.vue';
import NotificationToastContainer from '@/components/NotificationToastContainer.vue';

const route = useRoute();

const currentPathName = computed(() => {
  const p = route.params.path;
  const s = Array.isArray(p) ? p.join('/') : (p || '');
  const lastSegment = s.split('/').filter(Boolean).pop();
  return lastSegment || 'Shared';
});

useTitle(currentPathName);
</script>

<template>
  <div class="flex flex-col w-full h-full bg-base">
    <header
      class="flex items-center justify-between px-4 py-2 border-b border-neutral-200 dark:border-neutral-800 bg-white/90 dark:bg-base/90 backdrop-blur-sm z-10"
    >
      <div class="flex items-center gap-3">
        <HeaderLogo appname="Explorer" />
        <span class="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Shared
        </span>
      </div>
    </header>

    <main class="flex-1 overflow-y-auto">
      <ShareFolderView />
    </main>

    <NotificationToastContainer />
  </div>
</template>

