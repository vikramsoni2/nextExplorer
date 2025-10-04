import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Uppy from '@uppy/core';
import XHRUpload from '@uppy/xhr-upload';

import { apiBase, normalizePath } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useFileStore } from '@/stores/fileStore';
import { useUppyStore } from '@/stores/uppyStore';

interface DialogOptions {
  multiple?: boolean;
  accept?: string;
  directory?: boolean;
}

interface UppyFileInput {
  name: string;
  type: string;
  data: File;
  meta: {
    relativePath: string;
  };
}

export function useFileUploader() {
  const disallowedFiles = ['.DS_Store', 'thumbs.db'];
  const uppyStore = useUppyStore();
  const fileStore = useFileStore();
  const authStore = useAuthStore();
  const inputRef = ref<HTMLInputElement | null>(null);
  const files = ref<UppyFileInput[]>([]);

  const uppy = new Uppy({
    debug: true,
    autoProceed: true,
    // Pinia store implements the methods Uppy expects; cast to satisfy typings.
    store: uppyStore as unknown,
  });


  uppy.use(XHRUpload, {
    endpoint: `${apiBase}/api/upload`,
    formData: true,
    fieldName: 'filedata',
    bundle: false,
    allowedMetaFields: null
  });

  const applyAuthHeaders = (token: string | null): void => {
    const plugin = uppy.getPlugin('XHRUpload') as { setOptions: (options: Record<string, unknown>) => void } | undefined;
    if (!plugin) {
      return;
    }

    plugin.setOptions({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  };

  watch(
    () => authStore.token,
    (token) => {
      applyAuthHeaders(token);
    },
    { immediate: true },
  );

  uppy.on('file-added', (file) => {
    uppy.setFileMeta(file.id, {
      uploadTo: normalizePath(fileStore.currentPath || ''),
    });
  });

  uppy.on('upload-success', () => {
    fileStore.fetchPathItems(fileStore.currentPath);
  });

  const toUppyFile = (file: File): UppyFileInput => ({
    name: file.name,
    type: file.type,
    data: file,
    meta: {
      relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    },
  });

  const setDialogAttributes = (options: DialogOptions): void => {
    if (!inputRef.value) return;
    inputRef.value.accept = options.accept ?? '*/*';
    inputRef.value.multiple = Boolean(options.multiple);
    const directory = Boolean(options.directory);
    inputRef.value.webkitdirectory = directory;
    (inputRef.value as HTMLElement & { directory?: boolean; mozdirectory?: boolean }).directory = directory;
    (inputRef.value as HTMLElement & { mozdirectory?: boolean }).mozdirectory = directory;
  };

  const openDialog = (opts: DialogOptions = {}): Promise<void> => {
    const defaultDialogOptions: DialogOptions = {
      multiple: true,
      accept: '*/*',
    };

    return new Promise((resolve) => {
      if (!inputRef.value) return;

      files.value = [];
      const options: DialogOptions = { ...defaultDialogOptions, ...opts };

      setDialogAttributes(options);

      inputRef.value.onchange = (event: Event) => {
        const target = event.target as HTMLInputElement | null;
        const selectedFiles = Array.from(target?.files ?? []).filter(
          (file) => !disallowedFiles.includes(file.name),
        );

        files.value = selectedFiles.map((file) => toUppyFile(file));
        files.value.forEach((file) => uppy.addFile(file as unknown));

        if (target) {
          target.value = '';
        }
        resolve();
      };

      inputRef.value.click();
    });
  };
  

  // function process() {

  //   if (Array.isArray(files.value)) {
  //     // Handle the case where it's directly an array
  //     files.value.forEach(file => uppy.addFile(file));

  //   } else if (typeof files.value === 'object') {
  //     // Handle the case where it's an object of arrays
  //     Object.keys(files.value).forEach(key => {
  //       if (Array.isArray(files.value[key])) {
  //         console.log(`Processing list at key: ${key}`);
  //         files.value[key].forEach(file => uppy.addFile(file));
  //       } else {
  //         console.warn(`Expected an array at key: ${key}, but found:`, files.value[key]);
  //       }
  //     });
  //   } else {
  //     console.error('Unexpected data type for files.value:', files.value);
  //   }

  //   uppy.upload().then(result => {
  //     console.log(' uploads:', result);
  //     console.log('Successful uploads:', result.successful);
  //     console.log('Failed uploads:', result.failed);
  //   }).catch(error => {
  //     console.error('Upload error:', error);
  //   });

  // }

  onMounted(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.className = 'hidden';
    document.body.appendChild(input);
    inputRef.value = input;
  });

  onBeforeUnmount(() => {
    inputRef.value?.remove();
    uppy.close();
  });

  uppyStore.uppy = uppy;

  return {
    files,
    openDialog,
  } as const;
}



  // function onDrop(droppedFiles) {
  //   // each droppedFile to files array
  //   files.value.push(...droppedFiles)
  //   console.log(droppedFiles)
  // }


  
  // const { isOverDropZone } = useDropZone(dropzoneRef, {
  //   onDrop,
  // })



  // console.log(options)
