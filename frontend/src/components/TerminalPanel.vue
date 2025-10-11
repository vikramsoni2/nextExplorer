<template>

  <div 
  ref="dragline" 
  class="cursor-ns-resize w-full h-[4px] -ml-[2px] bg-nextgray-400 dark:bg-neutral-700 z-100"></div>
  <div 
  class="overflow-hidden"
  :style="{height: `${terminalHeight}px`}">
    <div ref="terminaldiv"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useDraggable } from '@vueuse/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

import { apiBase, appendAuthQuery } from '@/api';

// import { useSettingsStore } from '@/stores/settings';

// const settings = useSettingsStore()


const terminalHeight = ref(2);
const terminaldiv = ref<HTMLDivElement | null>(null);
const dragline = ref<HTMLElement | null>(null);

let term: Terminal | null = null;
let socket: WebSocket | null = null;
let fitAddon: FitAddon | null = null;

const sendInput = (data: string) => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(data);
  }
};

const toWebSocketScheme = (url: string): string => {
  if (url.startsWith('https://')) {
    return `wss://${url.slice(8)}`;
  }

  if (url.startsWith('http://')) {
    return `ws://${url.slice(7)}`;
  }

  return url;
};

const buildTerminalUrl = (): string => {
  const base = `${apiBase}/terminal`;
  const withScheme = toWebSocketScheme(base);
  return appendAuthQuery(withScheme);
};

const connectToBackend = (): void => {
  socket = new WebSocket(buildTerminalUrl());
  socket.onmessage = (event: MessageEvent<string>) => {
    term?.write(event.data);
  };
};

onMounted(() => {
  term = new Terminal();
  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  const host = terminaldiv.value;
  if (!host) {
    return;
  }

  term.open(host);
  fitAddon.fit();

  term.onData((data: string) => {
    sendInput(data);
  });

  connectToBackend();
});

onBeforeUnmount(() => {
  socket?.close();
  socket = null;
  term?.dispose();
  term = null;
  fitAddon = null;
});





useDraggable(dragline, {
  axis: 'y',
  preventDefault: true,
  onMove: (_position, event) => {
    const movementY = event.movementY ?? 0;
    terminalHeight.value -= movementY;
    terminalHeight.value = Math.max(2, Math.min(400, terminalHeight.value));

    const xtermScreen = document.querySelector('.xterm-screen');
    if (xtermScreen instanceof HTMLElement) {
      xtermScreen.style.height = `${terminalHeight.value}px !important`;
    }
  },
});


</script>

<style>

.xterm-screen {
  height: 400px !important;
}

</style>
