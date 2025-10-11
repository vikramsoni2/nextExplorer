<script setup lang="ts">
import { computed, onMounted, ref, type Component } from 'vue';
import * as OutlineIcons from '@heroicons/vue/24/outline';
import * as SolidIcons from '@heroicons/vue/24/solid';
import { useFavoritesStore } from '@/stores/favorites';
import { useNavigation } from '@/composables/navigation';
import type { FavoriteEntry } from '@/api';

const { ChevronDownIcon, StarIcon: StarIconOutline } = OutlineIcons;

const open = ref(true);
const favoritesStore = useFavoritesStore();
const { openBreadcrumb } = useNavigation();

onMounted(() => {
  favoritesStore.ensureLoaded();
});

const ICON_VARIANTS = ['outline', 'solid'] as const;
type IconVariant = typeof ICON_VARIANTS[number];

const iconRegistry: Record<IconVariant, Record<string, Component>> = {
  outline: OutlineIcons,
  solid: SolidIcons,
};

const isVariant = (value: string): value is IconVariant => (ICON_VARIANTS as readonly string[])
  .includes(value);

const resolveIconComponent = (iconName: string | null | undefined): Component => {
  if (typeof iconName !== 'string') {
    return StarIconOutline;
  }

  const trimmed = iconName.trim();
  if (!trimmed) {
    return StarIconOutline;
  }

  if (trimmed.includes(':')) {
    const [variantRaw = '', iconRaw = ''] = trimmed.split(':', 2);
    const variantKey = variantRaw.trim().toLowerCase();
    const iconKey = iconRaw.trim();
    if (isVariant(variantKey)) {
      const registry = iconRegistry[variantKey];
      const candidate = registry[iconKey];
      if (candidate) {
        return candidate;
      }
    }
  }

  const outlineIcon = (OutlineIcons as Record<string, Component>)[trimmed];
  if (outlineIcon) {
    return outlineIcon;
  }

  const solidIcon = (SolidIcons as Record<string, Component>)[trimmed];
  if (solidIcon) {
    return solidIcon;
  }

  return StarIconOutline;
};

interface FavoriteWithIcon extends FavoriteEntry {
  label: string;
  iconComponent: Component;
}

const favorites = computed<FavoriteWithIcon[]>(() => favoritesStore.favorites.map((favorite) => ({
  ...favorite,
  label: favorite.path.split('/').pop() || favorite.path,
  iconComponent: resolveIconComponent(favorite.icon),
})));

const handleOpenFavorite = (favorite: FavoriteEntry): void => {
  if (!favorite?.path) {
    return;
  }
  openBreadcrumb(favorite.path);
};
</script>

<template>
  <h4
    class="group flex items-center justify-between py-[6px] text-sm text-neutral-400 dark:text-neutral-500 font-medium"
  >
    Quick access
    <button
      @click="open = !open"
      class="hidden group-hover:block active:text-black dark:active:text-white text-neutral-500"
      type="button"
    >
      <ChevronDownIcon
        class="h-4 transition-transform duration-300 ease-in-out"
        :class="{ 'rotate-0': open, '-rotate-90': !open }"
      />
    </button>
  </h4>
  <div class="overflow-hidden">
    <transition
      enter-active-class="transition-all duration-500"
      leave-active-class="transition-all duration-500"
      enter-from-class="-mt-[100%]"
      enter-to-class="mt-0"
      leave-from-class="mt-0"
      leave-to-class="-mt-[100%]"
    >
      <div v-if="open" class="overflow-hidden">
        <template v-if="favorites.length">
          <button
            v-for="favorite in favorites"
            :key="favorite.path"
            type="button"
            class="flex w-full items-center gap-3 px-3 py-[6px] rounded-lg hover:bg-nextgray-300 dark:hover:bg-zinc-700"
            @click="handleOpenFavorite(favorite)"
          >
            <component :is="favorite.iconComponent" class="h-5" />
            <span class="truncate">{{ favorite.label }}</span>
          </button>
        </template>
        <p v-else class="px-3 py-[6px] text-xs text-neutral-400 dark:text-neutral-500">
          No favorites yet.
        </p>
      </div>
    </transition>
  </div>
</template>
