<script setup>
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import HeaderLogo from '@/components/HeaderLogo.vue';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const isProcessing = ref(true);
const errorMessage = ref('');

const sanitizeRedirect = (candidate) => {
  if (typeof candidate !== 'string') {
    return '/browse/';
  }

  const trimmed = candidate.trim();
  if (!trimmed) {
    return '/browse/';
  }

  if (!trimmed.startsWith('/')) {
    return '/browse/';
  }

  if (trimmed.startsWith('//')) {
    return '/browse/';
  }

  return trimmed;
};

onMounted(async () => {
  const tokenParam = typeof route.query?.token === 'string' ? route.query.token.trim() : '';
  const redirectParam = sanitizeRedirect(route.query?.redirect);

  if (tokenParam) {
    auth.applySessionToken(tokenParam);
  } else {
    errorMessage.value = 'Session token was not provided. Please try signing in again.';
  }

  try {
    await auth.initialize();
  } finally {
    isProcessing.value = false;
  }

  if (tokenParam) {
    router.replace(redirectParam);
    return;
  }

  router.replace({
    name: 'auth-login',
    query: {
      redirect: redirectParam,
      error: encodeURIComponent(errorMessage.value),
    },
  });
});
</script>

<template>
  <div class="min-h-screen bg-gradient-to-br from-nextzinc-900 via-slateblue to-nextgray-400/40 text-nextgray-100">
    <div class="flex min-h-screen items-center justify-center px-4 py-12">
      <div class="w-full max-w-lg rounded-3xl border border-white/10 bg-nextzinc-900/80 p-8 shadow-2xl shadow-black/40 backdrop-blur-md">
        <div class="flex items-center justify-between border-b border-white/5 pb-6">
          <HeaderLogo class="mb-0" />
          <span class="rounded-full bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-white/70">
            Secure Access
          </span>
        </div>

        <div class="mt-8 space-y-4 text-center">
          <div v-if="isProcessing" class="flex flex-col items-center gap-3">
            <div class="h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-accent"></div>
            <p class="text-lg font-medium text-white/80">Finalizing sign-in…</p>
          </div>

          <div v-else class="space-y-3">
            <p class="text-base text-white/80">Redirecting you back to your explorer.</p>
            <p v-if="errorMessage" class="text-sm text-red-400">{{ errorMessage }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
