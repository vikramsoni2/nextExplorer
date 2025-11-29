<script setup>
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ShareIcon, ChevronDownIcon } from '@heroicons/vue/24/outline';

const route = useRoute();
const router = useRouter();

const open = ref(true);

const currentPath = computed(() => {
  const path = route.params.path;
  if (Array.isArray(path)) {
    return path.join('/');
  }
  return typeof path === 'string' ? path : '';
});

const isActive = (target) => currentPath.value === target;

const goTo = (path) => {
  router.push({ path: `/browse/${path}` });
};
</script>

<template>
  <div>
    <h4
      class="group flex items-center justify-between pt-2 text-sm 
    text-neutral-400 dark:text-neutral-500
    font-medium"
    >
      Share
      <button
        @click="open = !open"
        class="hidden group-hover:block 
        active:text-black
        dark:active:text-white
        text-neutral-500"
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
          <button
            type="button"
            @click="goTo('shared/by-me')"
            :class="[
              'cursor-pointer flex w-full items-center gap-3 my-3 rounded-lg transition-colors duration-200 text-sm',
              isActive('shared/by-me')
                ? 'dark:text-white'
                : 'dark:text-neutral-300/90'
            ]"
          >
            <ShareIcon class="h-[1.2rem]" /> Shared by me
          </button>

          <button
            type="button"
            @click="goTo('shared/with-me')"
            :class="[
              'cursor-pointer flex w-full items-center gap-3 my-3 rounded-lg transition-colors duration-200 text-sm',
              isActive('shared/with-me')
                ? 'dark:text-white'
                : 'dark:text-neutral-300/90'
            ]"
          >
            <ShareIcon class="h-[1.2rem]" /> Shared with me
          </button>
        </div>
      </transition>
    </div>
  </div>
</template>

