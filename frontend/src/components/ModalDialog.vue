<script setup>
import { computed, defineProps, defineEmits } from 'vue';
import { IconX } from '@/components/icons';

const props = defineProps({
  modelValue: Boolean
});

const emit = defineEmits(['update:modelValue']);

const popupOpened = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

function onBackgroundClick() {
  if (popupOpened.value) {
    popupOpened.value = false;
  }
}


</script>
<template>
    <Teleport to="#app-container" v-if="popupOpened">
        <div  @click="onBackgroundClick"
        class="fixed top-0 z-30 flex items-center justify-center w-full h-full bg-opacity-50 max-sm:items-end bg-zinc-700 dark:bg-zinc-500 dark:bg-opacity-50">
            <div @click.stop
            class="rounded-xl w-[500px] shadow-lg 
            text-gray-800
            dark:text-neutral-300
            bg-white
            dark:bg-zinc-900 border 
            border-zinc-400 
            dark:border-zinc-700 transition-all duration-300"> 
                <div class="flex justify-between p-6">
                    <h2 class="flex items-center gap-2 text-lg font-bold">
                        <slot name="title">
                        Modal
                        </slot>
                    </h2> 
                    <button @click="popupOpened = false"><IconX class="h-6"/></button>
                </div>
                <hr class="h-px border-0 bg-zinc-300 dark:bg-zinc-800"/>

                <div class="p-6 py-6 text-sm">
                    <slot>
                      
                    </slot>
                    
                </div>
            </div>
        </div>
    </Teleport>
</template>