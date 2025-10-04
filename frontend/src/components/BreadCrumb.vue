<script setup lang="ts">
import { computed } from 'vue';
import { ChevronRight16Filled } from '@vicons/fluent';
import { useRoute } from 'vue-router';
import { useNavigation } from '@/composables/navigation';

const { openBreadcrumb } = useNavigation();
const route = useRoute();

interface BreadcrumbSegment {
  name: string;
  path: string;
}

const paths = computed<BreadcrumbSegment[]>(() => {
  const rawPath = route.params.path;
  const segments = typeof rawPath === 'string'
    ? rawPath.split('/')
    : Array.isArray(rawPath)
      ? rawPath
      : [];

  if (segments.length > 0) {
    const start = Math.max(0, segments.length - 3);
    return segments.slice(start).map((segment, index) => ({
      name: segment,
      path: segments.slice(0, start + index + 1).join('/'),
    }));
  }

  return [{ name: 'Volumes', path: '' }];
});
</script>

<template>
  <div class="flex items-center gap-3">
    <template v-for="(path, index) in paths" :key="index">
      <div v-if="index > 0">
        <ChevronRight16Filled class="h-4 text-gray-500 dark:text-gray-400" />
      </div>
      <button class="cursor-pointer line-clamp-1 text-ellipsis" @click="openBreadcrumb(path.path)">{{ path.name || 'Volumes' }}</button>
    </template>
  </div>
</template>
