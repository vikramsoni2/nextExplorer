

<script setup lang="ts">
import { ref } from 'vue';

const fileInput = ref<HTMLInputElement | null>(null);
const files = ref<File[]>([]);
const acceptsDirectories = ref(true);

const isDataTransferItemList = (items: FileList | DataTransferItemList): items is DataTransferItemList =>
  typeof (items as DataTransferItemList).add === 'function';

const getFileFromEntry = (entry: FileSystemFileEntry): Promise<File> => new Promise((resolve, reject) => {
  entry.file(resolve, reject);
});

const readDirectoryEntries = (directory: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> => new Promise((resolve, reject) => {
  const reader = directory.createReader();
  const entries: FileSystemEntry[] = [];

  const readBatch = () => {
    reader.readEntries((batch) => {
      if (!batch.length) {
        resolve(entries);
        return;
      }
      entries.push(...batch);
      readBatch();
    }, reject);
  };

  readBatch();
});

const collectEntry = async (entry: FileSystemEntry, accumulator: File[]): Promise<void> => {
  if (entry.isFile) {
    const file = await getFileFromEntry(entry as FileSystemFileEntry);
    accumulator.push(file);
    return;
  }

  if (entry.isDirectory) {
    const children = await readDirectoryEntries(entry as FileSystemDirectoryEntry);
    for (const child of children) {
      await collectEntry(child, accumulator);
    }
  }
};

const processItems = async (items: FileList | DataTransferItemList | null): Promise<File[]> => {
  if (!items) {
    return [];
  }

  if (!acceptsDirectories.value) {
    if (isDataTransferItemList(items)) {
      return Array.from({ length: items.length })
        .map((_, index) => items[index]?.getAsFile())
        .filter((file): file is File => Boolean(file));
    }

    return Array.from(items as FileList);
  }

  if (isDataTransferItemList(items)) {
    const collected: File[] = [];
    for (let index = 0; index < items.length; index += 1) {
      const entry = items[index]?.webkitGetAsEntry();
      if (entry) {
        await collectEntry(entry, collected);
      }
    }
    return collected;
  }

  return Array.from(items as FileList);
};

const updateFiles = (nextFiles: File[]) => {
  files.value = nextFiles;
};

const handleDragOver = (event: DragEvent) => {
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy';
  }
};

const handleDrop = async (event: DragEvent) => {
  event.preventDefault();
  const transfer = event.dataTransfer;
  if (!transfer) {
    return;
  }

  const nextFiles = await processItems(transfer.items ?? transfer.files);
  updateFiles(nextFiles);
};

const handleFiles = async (event: Event) => {
  const target = event.target as HTMLInputElement | null;
  const nextFiles = await processItems(target?.files ?? null);
  updateFiles(nextFiles);
};
</script>
<template>
  <div 
    class="dropzone"
    @dragover.prevent="handleDragOver"
    @drop.prevent="handleDrop"
  >
    Drop files or directories here
    <input 
      ref="fileInput" 
      type="file" 
      class="hidden" 
      @change="handleFiles" 
      multiple 
      :webkitdirectory="acceptsDirectories"
      :directory="acceptsDirectories"
      :mozdirectory="acceptsDirectories"
    />
  </div>
  <div v-for="file in files" :key="file.name">
    {{ file.name }} 
    </div>  
</template>
<style>
.dropzone {
  border: 2px dashed #ccc;
  padding: 20px;
  text-align: center;
  margin: 10px;
  cursor: pointer;
}

.hidden {
  display: none;
}
</style>
