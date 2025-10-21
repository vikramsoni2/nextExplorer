import { ref, onMounted, onBeforeUnmount } from "vue";

/**
 * @typedef {import('@/types').UploaderDialogOptions} UploaderDialogOptions
 * @typedef {import('@/types').FileDialogResult} FileDialogResult
 */

/** @type {UploaderDialogOptions} */
const defaultDialogOptions = {
  multiple: true,
  accept: '*',
  directory: true,
};

/**
 * Provides a hidden file input that can be programmatically triggered.
 * @returns {{
 *  openFileDialog: (opts?: UploaderDialogOptions) => Promise<void>,
 *  files: import('vue').Ref<FileDialogResult>
 * }}
 */
export function useFileDialog() {
  /** @type {import('vue').Ref<HTMLInputElement | null>} */
  const inputRef = ref(null);
  /** @type {import('vue').Ref<FileDialogResult>} */
  const files = ref([]);

  onMounted(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.className = "hidden";
    document.body.appendChild(input);
    inputRef.value = input;
  });

  onBeforeUnmount(() => {
    inputRef.value?.remove();
  });

  /**
   * Open the file picker with the provided options.
   * @param {UploaderDialogOptions} [opts]
   * @returns {Promise<void>}
   */
  function openFileDialog(opts) {
    return new Promise((resolve) => {
      if (!inputRef.value) {
        return;
      }
      files.value = [];

      const options = { ...defaultDialogOptions, ...(opts || {}) };
      const acceptValue = Array.isArray(options.accept)
        ? options.accept.join(',')
        : options.accept || '*';
      inputRef.value.accept = acceptValue;
      inputRef.value.multiple = options.multiple;
      
      if (options.directory) {
        inputRef.value.webkitdirectory = !!options.directory;  
        inputRef.value.directory = !!options.directory;       
        inputRef.value.mozdirectory = !!options.directory;
      }

      inputRef.value.onchange = (e) => {
        if (options.directory) {
          // Process directory files
          const items = Array.from(e.target.files);
          const directories = {};
          items.forEach(file => {
            const path = file.webkitRelativePath.split('/');
            const dir = path[0];
            if (!directories[dir]) {
              directories[dir] = [];
            }
            directories[dir].push(file);
          });
          files.value = directories;
        } else {
          // Process individual files
          files.value = Array.from(e.target.files);
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
