<script setup>
import { computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { TrashIcon } from '@heroicons/vue/24/outline';
import { useI18n } from 'vue-i18n';

const router = useRouter();
const route = useRoute();
const { t } = useI18n();

const isActive = computed(() => route.path.startsWith('/trash'));

const openTrash = () => {
  router.push({ path: '/trash' });
};
</script>

<template>
  <h4
    class="group flex items-center justify-between pb-2 pt-6 text-sm text-neutral-400 dark:text-neutral-500 font-medium"
  >
    {{ t('trash.title') }}
  </h4>
  <button
    type="button"
    @click="openTrash"
    :class="[
      'cursor-pointer flex w-full items-center gap-3 my-3 rounded-lg px-1.5 py-1.5 text-sm transition-colors duration-200',
      isActive
        ? 'text-neutral-950 bg-neutral-200/70 dark:text-white dark:bg-neutral-700/60'
        : 'text-neutral-900 dark:text-neutral-300/80 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/60'
    ]"
  >
    <TrashIcon class="h-[1.38rem]" />
    <span class="truncate">{{ t('trash.title') }}</span>
  </button>
</template>

