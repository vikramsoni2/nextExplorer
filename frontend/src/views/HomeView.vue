<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useSettingsStore } from '@/stores/settings';
import FileObject from '@/components/FileObject.vue';
import { browse, type FileItem } from '@/api';

const settings = useSettingsStore();
const route = useRoute();
const resources = ref<FileItem[] | null>(null);

onMounted(async () => {
  const path = route.path;
  resources.value = await browse(path);
});
</script>

<template>
    
    <div :class="settings.view === 'grid' ? 'grid grid-cols-[repeat(auto-fill,6rem)] gap-2' : 'flex flex-col gap-2'">
      <div v-for="item in resources ?? []" :key="item.name">
        <FileObject :item="item" :view="settings.view"/>
      </div>
    </div>

</template>
