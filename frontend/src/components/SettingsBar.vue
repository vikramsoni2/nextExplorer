<script setup>
import { useSettingsStore } from '@/stores/settings'
import {
  Cog8ToothIcon
} from '@heroicons/vue/24/outline'

import { SunIcon, MoonIcon } from '@heroicons/vue/24/outline'

const settings = useSettingsStore()



</script>

<template>

  <div class="flex gap-1 items-center">

    <button title="toggle dark mode" @click="settings.toggleDark()"
      class="p-[6px] rounded-md dark:hover:bg-zinc-700 dark:active:bg-zinc-600">
      <SunIcon class="w-6" v-if="settings.isDark" />
      <MoonIcon class="w-6" v-else />
    </button>

    <button class="p-[6px] rounded-md dark:hover:bg-zinc-700 dark:active:bg-zinc-600">
      <Cog8ToothIcon class="w-6" />
    </button>

  </div>

</template>