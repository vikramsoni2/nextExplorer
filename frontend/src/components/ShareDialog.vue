<script setup>
import { computed, ref, watch } from 'vue';
import ModalDialog from '@/components/ModalDialog.vue';
import { useFileActions } from '@/composables/fileActions';
import { createShare, addShareUser, buildShareLink, fetchUsers } from '@/api';

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update:modelValue']);

const isOpen = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
});

const fileActions = useFileActions();

const primaryItem = computed(() => fileActions.primaryItem.value);
const targetName = computed(() => primaryItem.value?.name || '');
const isDirectory = computed(() => (primaryItem.value?.kind || '').toLowerCase() === 'directory');

const mode = ref('ro'); // 'ro' | 'rw'
const passwordEnabled = ref(false);
const password = ref('');
const label = ref('');

const isSubmitting = ref(false);
const shareUrl = ref('');

const users = ref([]);
const selectedUserIds = ref([]);
const loadingUsers = ref(false);
const usersError = ref(null);

const resetState = () => {
  mode.value = 'ro';
  passwordEnabled.value = false;
  password.value = '';
  label.value = '';
  isSubmitting.value = false;
  shareUrl.value = '';
  users.value = [];
  selectedUserIds.value = [];
  loadingUsers.value = false;
  usersError.value = null;
};

const loadUsers = async () => {
  loadingUsers.value = true;
  usersError.value = null;
  try {
    const response = await fetchUsers();
    const list = Array.isArray(response?.users) ? response.users : [];
    users.value = list;
  } catch (error) {
    // Non-fatal: sharing with specific users is optional
    console.error('Failed to load users for sharing', error);
    usersError.value = error;
  } finally {
    loadingUsers.value = false;
  }
};

watch(isOpen, (open) => {
  if (open) {
    resetState();
    // Only attempt to load users when dialog is opened.
    loadUsers();
  }
});

const hasTarget = computed(() => Boolean(primaryItem.value && targetName.value));

const handleCreateShare = async () => {
  if (!hasTarget.value || isSubmitting.value) return;

  isSubmitting.value = true;
  try {
    const path = fileActions.resolveItemPath(primaryItem.value);
    if (!path) {
      throw new Error('Unable to resolve path for selected item.');
    }

    const type = isDirectory.value ? 'directory' : 'file';

    const response = await createShare(path, {
      mode: mode.value,
      type,
      label: label.value,
      password: passwordEnabled.value ? password.value : undefined,
    });

    const share = response?.share;
    if (!share || !share.id) {
      throw new Error('Share was created but no identifier was returned.');
    }

    // Prefer backend-provided absolute link; fall back to client-built link
    if (typeof response?.link === 'string' && response.link.trim()) {
      shareUrl.value = response.link.trim();
    } else {
      shareUrl.value = buildShareLink(share.id);
    }

    const ids = Array.isArray(selectedUserIds.value) ? selectedUserIds.value : [];
    if (ids.length > 0) {
      await Promise.all(ids.map((userId) => addShareUser(share.id, userId, { accessMode: mode.value })));
    }
  } catch (error) {
    console.error('Failed to create share', error);
  } finally {
    isSubmitting.value = false;
  }
};

const handleCopyLink = async () => {
  if (!shareUrl.value || typeof navigator === 'undefined' || !navigator.clipboard) return;
  try {
    await navigator.clipboard.writeText(shareUrl.value);
  } catch (error) {
    console.error('Failed to copy share link to clipboard', error);
  }
};
</script>

<template>
  <ModalDialog v-model="isOpen">
    <template #title>
      <span v-if="hasTarget">
        {{ $t('share.share') }} "{{ targetName }}"
      </span>
      <span v-else>
        {{ $t('share.share') }}
      </span>
    </template>

    <div class="space-y-6">
      <div class="space-y-1">
        <p class="text-sm text-neutral-600 dark:text-neutral-300">
          {{ isDirectory ? $t('share.sharingFolder') : $t('share.sharingFile') }}
        </p>
      </div>

      <div class="space-y-2">
        <label class="block text-sm font-medium text-neutral-700 dark:text-neutral-200">
          {{ $t('share.access') }}
        </label>
        <div class="flex gap-4 mt-1 text-sm">
          <label class="inline-flex items-center gap-2 cursor-pointer">
            <input
              v-model="mode"
              type="radio"
              value="ro"
              class="text-blue-600 focus:ring-blue-500"
            />
            <span>{{ $t('share.viewOnly') }}</span>
          </label>
          <label class="inline-flex items-center gap-2 cursor-pointer">
            <input
              v-model="mode"
              type="radio"
              value="rw"
              class="text-blue-600 focus:ring-blue-500"
            />
            <span>{{ $t('share.canEdit') }}</span>
          </label>
        </div>
      </div>

      <div class="space-y-2">
        <label class="block text-sm font-medium text-neutral-700 dark:text-neutral-200">
          {{ $t('share.labelOptional') }}
        </label>
        <input
          v-model="label"
          type="text"
          class="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm
            bg-white text-neutral-900
            dark:bg-neutral-900 dark:text-neutral-100 dark:border-neutral-700
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          :placeholder="$t('share.labelPlaceholder')"
        />
      </div>

      <div class="space-y-2">
        <label class="inline-flex items-center gap-2 text-sm font-medium text-neutral-700 dark:text-neutral-200 cursor-pointer">
          <input
            v-model="passwordEnabled"
            type="checkbox"
            class="text-blue-600 focus:ring-blue-500"
          />
          <span>{{ $t('share.passwordProtect') }}</span>
        </label>
        <input
          v-model="password"
          type="password"
          :disabled="!passwordEnabled"
          class="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm
            bg-white text-neutral-900
            dark:bg-neutral-900 dark:text-neutral-100 dark:border-neutral-700
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
            disabled:bg-neutral-100 disabled:text-neutral-400 disabled:cursor-not-allowed
            dark:disabled:bg-neutral-800 dark:disabled:text-neutral-500"
          :placeholder="$t('share.passwordPlaceholder')"
        />
      </div>

      <div v-if="!loadingUsers && users.length > 0" class="space-y-2">
        <label class="block text-sm font-medium text-neutral-700 dark:text-neutral-200">
          {{ $t('share.shareWithUsers') }}
        </label>
        <div class="max-h-40 overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-700 px-2 py-1">
          <label
            v-for="user in users"
            :key="user.id"
            class="flex items-center gap-2 py-1 text-sm cursor-pointer"
          >
            <input
              v-model="selectedUserIds"
              type="checkbox"
              :value="user.id"
              class="text-blue-600 focus:ring-blue-500"
            />
            <span class="truncate">
              {{ user.displayName || user.username || user.email || user.id }}
            </span>
          </label>
        </div>
      </div>

      <div v-else-if="loadingUsers" class="text-xs text-neutral-500 dark:text-neutral-400">
        {{ $t('share.loadingUsers') }}
      </div>

      <div v-if="shareUrl" class="space-y-2">
        <label class="block text-sm font-medium text-neutral-700 dark:text-neutral-200">
          {{ $t('share.link') }}
        </label>
        <div class="flex gap-2">
          <input
            type="text"
            readonly
            :value="shareUrl"
            class="flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-sm
              bg-neutral-50 text-neutral-900
              dark:bg-neutral-900 dark:text-neutral-100 dark:border-neutral-700
              focus:outline-none"
          />
          <button
            type="button"
            class="px-3 py-1.5 text-xs font-medium rounded-md border border-neutral-300 text-neutral-700
              bg-white hover:bg-neutral-100 active:bg-neutral-200
              dark:bg-neutral-800 dark:text-neutral-100 dark:border-neutral-600
              dark:hover:bg-neutral-700 dark:active:bg-neutral-600"
            @click="handleCopyLink"
          >
            {{ $t('share.copyLink') }}
          </button>
        </div>
      </div>

      <div class="flex justify-end gap-2 pt-2">
        <button
          type="button"
          class="px-4 py-1.5 text-sm font-medium rounded-md border border-neutral-300 text-neutral-700
            bg-white hover:bg-neutral-100 active:bg-neutral-200
            dark:bg-neutral-800 dark:text-neutral-100 dark:border-neutral-600
            dark:hover:bg-neutral-700 dark:active:bg-neutral-600"
          @click="isOpen = false"
          :disabled="isSubmitting"
        >
          {{ $t('share.close') }}
        </button>
        <button
          type="button"
          class="px-4 py-1.5 text-sm font-medium rounded-md text-white
            bg-blue-600 hover:bg-blue-500 active:bg-blue-700
            disabled:opacity-60 disabled:cursor-not-allowed
            dark:bg-blue-500 dark:hover:bg-blue-400 dark:active:bg-blue-600"
          @click="handleCreateShare"
          :disabled="!hasTarget || isSubmitting"
        >
          <span v-if="isSubmitting">{{ $t('share.creating') }}</span>
          <span v-else>{{ shareUrl ? $t('share.updateLink') : $t('share.createLink') }}</span>
        </button>
      </div>
    </div>
  </ModalDialog>
</template>
