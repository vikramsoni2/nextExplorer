<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTitle } from '@vueuse/core';

import HeaderLogo from '@/components/HeaderLogo.vue';
import ShareFolderView from '@/views/ShareFolderView.vue';
import NotificationToastContainer from '@/components/NotificationToastContainer.vue';

const route = useRoute();
const router = useRouter();

const handleLoginClick = () => {
  const redirect = typeof route.fullPath === 'string' && route.fullPath ? route.fullPath : '/browse/';
  router.push({ name: 'auth-login', query: { redirect } });
};

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
      <button
        type="button"
        class="inline-flex items-center rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm hover:bg-neutral-50 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
        @click="handleLoginClick"
      >
        {{ $t('auth.login.submit') }}
      </button>
    </header>

    <main class="flex-1 overflow-y-auto">
      <div
        class="px-4 pt-3 pb-2 text-xs text-neutral-600 dark:text-neutral-300 bg-white/80 dark:bg-base/80 border-b border-neutral-100 dark:border-neutral-800"
      >
        <p>
          You are viewing a read-only public share.
          <span class="ml-1">
            Log in to access full features like file previews, editing, and more.
          </span>
        </p>
      </div>
      <ShareFolderView />
    </main>

    <NotificationToastContainer />
  </div>
</template>
