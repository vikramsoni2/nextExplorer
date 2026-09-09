<script setup>
import { computed } from 'vue';
import { formatBytes } from '@/utils';
import { useI18n } from 'vue-i18n';

// Displays a folder's pre-computed recursive size as formatted text. Styled to
// match the surrounding size column (VolumeUsageBar's Tailwind-only approach);
// folders have no quota, so there is no bar — just the formatted byte count,
// with a muted placeholder while the size is not yet indexed.
const props = defineProps({
  entry: { type: Object, default: null },
  placeholder: { type: String, default: '—' },
});
const { t } = useI18n();

const hasSize = computed(
  () =>
    props.entry &&
    !props.entry.dirty &&
    props.entry.sizeBytes !== null &&
    Number.isFinite(props.entry.sizeBytes)
);

const label = computed(() => {
  if (hasSize.value) return formatBytes(props.entry.sizeBytes);
  return props.entry?.excluded ? t('info.folderSizeExcluded') : props.placeholder;
});

const title = computed(() => {
  if (props.entry?.excluded) return t('info.folderSizeExcludedHelp');
  if (!hasSize.value) {
    if (props.entry?.dirty) return 'Size is being calculated';
    return props.entry && !props.entry.indexed ? 'Size not indexed yet' : '';
  }
  const parts = [formatBytes(props.entry.sizeBytes)];
  if (Number.isFinite(props.entry.entryCount)) {
    parts.push(`${props.entry.entryCount} item${props.entry.entryCount === 1 ? '' : 's'}`);
  }
  if (!props.entry.canEnter) parts.push('no access');
  return parts.join(' · ');
});
</script>

<template>
  <span
    class="tabular-nums"
    :class="hasSize ? '' : 'text-neutral-400 dark:text-neutral-500'"
    :title="title"
  >
    {{ label }}
  </span>
</template>
