<script setup>
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ChevronDownIcon, TrashIcon } from '@heroicons/vue/24/outline';

const { t } = useI18n();
const open = ref(true);
const route = useRoute();
const router = useRouter();

const isTrashActive = computed(() => route.name === 'Trash');

const openTrash = () => {
  router.push({ name: 'Trash' });
};
</script>

<template>
  <div>
    <h4
      class="group flex items-center justify-between py-2 pt-2 text-sm text-neutral-400 dark:text-neutral-500 font-medium"
    >
      {{ t('common.trash') }}
      <button
        @click="open = !open"
        class="hidden group-hover:block active:text-black dark:active:text-white text-neutral-500"
        type="button"
      >
        <ChevronDownIcon
          class="h-4 transition-transform duration-300 ease-in-out"
          :class="{ 'rotate-0': open, '-rotate-90': !open }"
        />
      </button>
    </h4>
    <div class="overflow-hidden">
      <transition
        enter-active-class="transition-all duration-500"
        leave-active-class="transition-all duration-500"
        enter-from-class="-mt-[100%]"
        enter-to-class="mt-0"
        leave-from-class="mt-0"
        leave-to-class="-mt-[100%]"
      >
        <div v-if="open" class="overflow-hidden">
          <div class="mb-3">
            <button
              type="button"
              @click="openTrash"
              class="cursor-pointer flex w-full items-center gap-3 rounded-lg text-sm truncate"
              :class="[
                isTrashActive
                  ? 'text-neutral-950 dark:text-white'
                  : 'text-neutral-950 dark:text-neutral-300/90'
              ]"
            >
              <TrashIcon class="h-5 shrink-0" />
              <span class="truncate">{{ t('common.trash') }}</span>
            </button>
          </div>
        </div>
      </transition>
    </div>
  </div>
</template>

