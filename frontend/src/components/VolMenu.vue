<script setup>
import {ServerIcon, ChevronDownIcon } from '@heroicons/vue/24/outline'
import {getVolumes} from '@/api'
import { ref, onMounted } from 'vue';
import {useNavigation} from '@/composables/navigation';

const {openItem} = useNavigation()

const volumes = ref([])

onMounted(async () => {
    volumes.value = await getVolumes()
})

const open = ref(true);

</script>

<template>
    <h4 
    class="group flex items-center justify-between py-[6px] text-sm 
    text-neutral-400 dark:text-neutral-500 font-medium">
        Volumes
        <button 
        @click="open = !open"
        class="hidden group-hover:block 
        active:text-black
        dark:active:text-white
        text-neutral-500">
            <ChevronDownIcon class="h-4 transition-transform duration-300 ease-in-out" :class="{'rotate-0': open, '-rotate-90': !open}" />
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
            <button 
                v-for="volume in volumes" :key="volume.name"
                @click="openItem(volume)"
                class="cursor-pointer flex w-full items-center gap-3 px-3 py-[6px] 
                hover:bg-nextgray-300 
                rounded-md dark:hover:bg-zinc-700 dark:active:bg-zinc-600">
                    <ServerIcon class="h-5"/> {{volume.name}}
            </button>
        </div>
    </transition>
    </div>
</template>