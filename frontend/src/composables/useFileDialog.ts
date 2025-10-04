import { onBeforeUnmount, onMounted, ref } from 'vue';

interface DialogOptions {
  multiple: boolean;
  accept: string;
  directory: boolean;
}

const defaultDialogOptions: DialogOptions = {
  multiple: true,
  accept: '*/*',
  directory: true,
};

type FileDialogResult = File[] | Record<string, File[]>;

export function useFileDialog() {
  const inputRef = ref<HTMLInputElement | null>(null);
  const files = ref<FileDialogResult | null>(null);

  onMounted(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.className = 'hidden';
    document.body.appendChild(input);
    inputRef.value = input;
  });

  onBeforeUnmount(() => {
    inputRef.value?.remove();
  });

  function openFileDialog(opts: Partial<DialogOptions> = {}): Promise<void> {
    return new Promise((resolve) => {
      if (!inputRef.value) {
        return;
      }

      const options: DialogOptions = { ...defaultDialogOptions, ...opts };
      inputRef.value.accept = options.accept;
      inputRef.value.multiple = options.multiple;

      if (options.directory) {
        inputRef.value.webkitdirectory = true;
        (inputRef.value as HTMLElement & { directory?: boolean; mozdirectory?: boolean }).directory = true;
        (inputRef.value as HTMLElement & { mozdirectory?: boolean }).mozdirectory = true;
      } else {
        inputRef.value.webkitdirectory = false;
        (inputRef.value as HTMLElement & { directory?: boolean; mozdirectory?: boolean }).directory = false;
        (inputRef.value as HTMLElement & { mozdirectory?: boolean }).mozdirectory = false;
      }

      inputRef.value.onchange = (event: Event) => {
        const target = event.target as HTMLInputElement | null;
        const list = Array.from(target?.files ?? []);

        if (options.directory) {
          const directories: Record<string, File[]> = {};
          list.forEach((file) => {
            const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath?.split('/') ?? [];
            const dir = path[0] ?? '';
            if (!directories[dir]) {
              directories[dir] = [];
            }
            directories[dir].push(file);
          });
          files.value = directories;
        } else {
          files.value = list;
        }

        if (target) {
          target.value = '';
        }
        resolve();
      };

      inputRef.value.click();
    });
  }

  return {
    openFileDialog,
    files,
  };
}
