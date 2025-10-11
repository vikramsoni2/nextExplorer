<template>
  <div class="p-4">
    <h1 class="text-lg font-semibold">{{ msg }}</h1>
  </div>
</template>

<script setup lang="ts">
defineProps<{ msg: string }>();
</script>
