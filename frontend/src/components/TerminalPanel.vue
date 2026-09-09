<template>
  <teleport to="body">
    <!-- Backdrop -->
    <transition name="tp-fade">
      <div v-if="isOpen" class="fixed inset-0 z-1450 bg-black/30 dark:bg-black/50" @click="close" />
    </transition>

    <!-- Panel -->
    <div
      class="fixed inset-y-0 right-0 z-1500 w-full sm:w-[600px] md:w-[700px] lg:w-[800px] transform transition-transform duration-200 ease-out"
      :class="isOpen ? 'translate-x-0' : 'translate-x-full'"
    >
      <aside
        ref="panelRef"
        class="flex h-full flex-col border-l bg-zinc-900 dark:bg-zinc-950 shadow-2xl dark:border-white/10"
      >
        <header class="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <h2 class="text-lg font-semibold text-white">
            {{ $t('titles.terminal') }}
          </h2>
          <button
            @click="close"
            class="rounded-lg p-1.5 text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
            :aria-label="$t('common.close')"
          >
            <XMarkIcon class="w-5 h-5" />
          </button>
        </header>
        <div class="flex-1 overflow-hidden p-4">
          <div ref="terminaldiv" class="h-full"></div>
        </div>
      </aside>
    </div>
  </teleport>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { XMarkIcon } from '@heroicons/vue/24/outline';

import { apiBase, createTerminalSession } from '@/api';
import { useFileStore } from '@/stores/fileStore';
import { useTerminalStore } from '@/stores/terminal';
import { onClickOutside } from '@vueuse/core';
import logger from '@/utils/logger';

const terminalStore = useTerminalStore();
const fileStore = useFileStore();
const { isOpen, launchPath, launchInput, launchKey } = storeToRefs(terminalStore);
const { close } = terminalStore;

const terminaldiv = ref(null);
const panelRef = ref(null);
let term;
let socket;
let fitAddon;
let resizeObserver;
let pendingResize;
let launchInputTimer;
let launchInputSent = false;
let refreshTimer;

// Prefix used to send control messages (like resize) over the same WS channel as raw terminal input.
// This avoids collisions with normal shell input (xterm sends raw keystrokes).
const CONTROL_PREFIX = '\u001e';

const sendInput = (data) => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(data);
  }
};

const normalizeLogicalPath = (value = '') =>
  String(value || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/');

const clearRefreshTimer = () => {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
};

const refreshBrowserState = () => {
  const currentPath = normalizeLogicalPath(fileStore.currentPath || '');
  const terminalPath = normalizeLogicalPath(launchPath.value || '');

  if (terminalPath && currentPath === terminalPath) {
    fileStore.fetchPathItems(currentPath).catch(() => {});
  }
};

const scheduleBrowserRefresh = (delayMs = 900) => {
  clearRefreshTimer();
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshBrowserState();
  }, delayMs);
};

const sendResize = (cols, rows) => {
  const safeCols = Number.isFinite(cols) ? Math.max(1, Math.floor(cols)) : null;
  const safeRows = Number.isFinite(rows) ? Math.max(1, Math.floor(rows)) : null;
  if (!safeCols || !safeRows) return;

  pendingResize = { cols: safeCols, rows: safeRows };

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(
      `${CONTROL_PREFIX}${JSON.stringify({
        type: 'resize',
        cols: safeCols,
        rows: safeRows,
      })}`
    );
  }
};

const clearLaunchInputTimer = () => {
  if (launchInputTimer) {
    clearTimeout(launchInputTimer);
    launchInputTimer = null;
  }
};

const scheduleLaunchInput = () => {
  if (launchInputSent || !launchInput.value) return;

  clearLaunchInputTimer();
  launchInputTimer = setTimeout(() => {
    if (launchInputSent || !launchInput.value) return;
    sendInput(launchInput.value);
    launchInputSent = true;
    launchInputTimer = null;
  }, 150);
};

const focusTerminal = () => {
  requestAnimationFrame(() => {
    term?.focus();
    setTimeout(() => {
      term?.focus();
    }, 50);
  });
};

const toWebSocketScheme = (url) => {
  if (url.startsWith('https://')) {
    return `wss://${url.slice(8)}`;
  }

  if (url.startsWith('http://')) {
    return `ws://${url.slice(7)}`;
  }

  return url;
};

const buildTerminalUrl = (token) => {
  const base = `${apiBase}/api/terminal`;
  const withScheme = toWebSocketScheme(base);
  const url = `${withScheme}?token=${encodeURIComponent(token)}`;
  logger.debug('Terminal WebSocket URL - apiBase', apiBase);
  logger.debug('Terminal WebSocket URL - base', base);
  logger.debug('Terminal WebSocket URL - final', url);
  return url;
};

const connectToBackend = async () => {
  try {
    const session = await createTerminalSession(launchPath.value || '');
    const token = session?.token;
    if (!token) {
      console.error('Failed to obtain terminal session token');
      return;
    }

    const url = buildTerminalUrl(token);
    logger.debug('Attempting to connect to terminal WebSocket', url);
    socket = new WebSocket(url);

    socket.onopen = () => {
      logger.debug('Terminal WebSocket connection opened');
      if (pendingResize) {
        sendResize(pendingResize.cols, pendingResize.rows);
      }
    };

    socket.onmessage = (event) => {
      logger.debug('Received data from terminal', event.data.length, 'bytes');
      if (typeof event.data === 'string' && event.data.startsWith(CONTROL_PREFIX)) {
        try {
          const payload = JSON.parse(event.data.slice(CONTROL_PREFIX.length));
          if (payload?.type === 'filesystemChanged') {
            scheduleBrowserRefresh(500);
          }
        } catch (error) {
          logger.warn('Invalid terminal control message from backend', error);
        }
        return;
      }

      term.write(event.data, scheduleLaunchInput);
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    socket.onclose = (event) => {
      logger.debug('WebSocket connection closed', event.code, event.reason);
    };
  } catch (error) {
    console.error('Failed to connect to terminal:', error);
  }
};

const initTerminal = () => {
  if (!terminaldiv.value || term) return;

  term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    theme: {
      background: '#09090b',
      foreground: '#e4e4e7',
      cursor: '#22d3ee',
      cursorAccent: '#09090b',
      selectionBackground: 'rgba(255, 255, 255, 0.2)',
      selectionForeground: '#ffffff',

      // Normal colors
      black: '#27272a',
      red: '#f87171',
      green: '#4ade80',
      yellow: '#facc15',
      blue: '#60a5fa',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      white: '#e4e4e7',

      // Bright colors
      brightBlack: '#71717a',
      brightRed: '#fca5a5',
      brightGreen: '#86efac',
      brightYellow: '#fde047',
      brightBlue: '#93c5fd',
      brightMagenta: '#d8b4fe',
      brightCyan: '#67e8f9',
      brightWhite: '#fafafa',
    },
  });
  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(terminaldiv.value);
  focusTerminal();

  term.onResize(({ cols, rows }) => {
    sendResize(cols, rows);
  });

  resizeObserver = new ResizeObserver(() => {
    // Defer to ensure layout has settled (esp. during panel open/resize).
    requestAnimationFrame(() => {
      fitAddon?.fit();
    });
  });
  resizeObserver.observe(terminaldiv.value);

  // Initial fit (also triggers `onResize` -> sends size to backend).
  requestAnimationFrame(() => {
    fitAddon.fit();
    focusTerminal();
  });

  term.onData((data) => {
    sendInput(data);
    scheduleBrowserRefresh(1800);
  });

  connectToBackend();
};

const teardownTerminal = () => {
  clearLaunchInputTimer();
  clearRefreshTimer();
  launchInputSent = false;

  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }

  if (socket) {
    socket.close();
    socket = null;
  }

  if (term) {
    term.dispose();
    term = null;
  }

  fitAddon = null;
  pendingResize = null;
};

watch([isOpen, launchKey], ([newVal]) => {
  if (newVal) {
    teardownTerminal();
    setTimeout(() => {
      initTerminal();
      if (fitAddon) {
        fitAddon.fit();
      }
    }, 250);
  } else {
    teardownTerminal();
  }
});

onMounted(() => {
  if (isOpen.value) {
    initTerminal();
  }
});

onBeforeUnmount(() => {
  teardownTerminal();
});

onClickOutside(panelRef, () => {
  if (isOpen.value) {
    close();
  }
});
</script>

<style>
.tp-fade-enter-active,
.tp-fade-leave-active {
  transition: opacity 0.2s ease;
}

.tp-fade-enter-from,
.tp-fade-leave-to {
  opacity: 0;
}
</style>
