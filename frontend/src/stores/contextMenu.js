import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useContextMenuStore = defineStore('contextMenu', () => {
  const isOpen = ref(false);
  const position = ref({ x: 0, y: 0 });
  const context = ref(null);

  const open = (payload = {}) => {
    const {
      x = 0,
      y = 0,
      context: nextContext = null,
    } = payload;

    position.value = { x, y };
    context.value = nextContext;
    isOpen.value = true;
  };

  const close = () => {
    isOpen.value = false;
    context.value = null;
  };

  return {
    isOpen,
    position,
    context,
    open,
    close,
  };
});
