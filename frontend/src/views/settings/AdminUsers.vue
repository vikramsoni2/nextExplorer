<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  fetchUsers,
  createUser
} from '@/api';
import { useI18n } from 'vue-i18n';

const router = useRouter();
const { t } = useI18n();
const users = ref([]);
const loading = ref(false);
const errorMsg = ref('');

const showCreateModal = ref(false);

// Create user form state
const newEmail = ref('');
const newUsername = ref('');
const newPassword = ref('');
const newIsAdmin = ref(false);
const creating = ref(false);

const loadUsers = async () => {
  loading.value = true;
  errorMsg.value = '';
  try {
    const res = await fetchUsers();
    users.value = Array.isArray(res?.users) ? res.users : [];
  } catch (e) {
    errorMsg.value = e?.message || t('settings.users.failedLoad');
  } finally {
    loading.value = false;
  }
};

const openCreateModal = () => {
  showCreateModal.value = true;
};

const resetCreateForm = () => {
  newEmail.value = '';
  newUsername.value = '';
  newPassword.value = '';
  newIsAdmin.value = false;
};

const closeCreateModal = () => {
  showCreateModal.value = false;
  resetCreateForm();
};

const handleCreate = async () => {
  if (!newEmail.value.trim()) {
    alert(t('auth.errors.emailRequired'));
    return;
  }
  if (newPassword.value.length < 6) {
    alert(t('settings.users.passwordMin'));
    return;
  }
  creating.value = true;
  try {
    const res = await createUser({
      email: newEmail.value.trim(),
      username: newUsername.value.trim() || newEmail.value.trim().split('@')[0],
      password: newPassword.value,
      roles: newIsAdmin.value ? ['admin'] : []
    });
    if (res?.user) {
      users.value = users.value.concat([res.user]);
      closeCreateModal();
    }
  } catch (e) {
    alert(e?.message || t('settings.users.failedCreate'));
  } finally {
    creating.value = false;
  }
};

const goToUserDetail = (user) => {
  router.push(`/settings/admin-users/${user.id}`);
};

// Format relative time
const formatRelativeTime = (isoString) => {
  if (!isoString) return t('settings.users.neverLoggedIn');

  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return t('settings.users.justNow');
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`;
  if (diffDay < 365) return `${Math.floor(diffDay / 30)}mo ago`;
  return `${Math.floor(diffDay / 365)}y ago`;
};

// Format auth mode badge
const formatAuthModes = (authModes) => {
  if (!authModes || authModes.length === 0) {
    return [{ label: t('settings.users.noAuthMethods'), type: 'none' }];
  }

  const modes = [];
  if (authModes.includes('local_password')) {
    modes.push({ label: 'Local', type: 'local' });
  }
  if (authModes.includes('oidc')) {
    modes.push({ label: 'OIDC', type: 'oidc' });
  }

  return modes;
};

onMounted(() => { loadUsers(); });
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-3">
      <h2 class="text-lg font-semibold">{{ t('settings.users.title') }}</h2>
      <span v-if="loading" class="text-sm opacity-75">{{ t('common.loading') }}…</span>
      <div class="ml-auto">
        <button
          type="button"
          class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-black hover:bg-accent/90 transition-colors"
          @click="openCreateModal"
        >
          {{ t('settings.users.createUser') }}
        </button>
      </div>
    </div>
    <p v-if="errorMsg" class="text-sm text-red-500">{{ errorMsg }}</p>

    <!-- Card-based user list -->
    <div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      <div
        v-for="u in users"
        :key="u.id"
        class="group cursor-pointer rounded-lg border border-white/10 bg-white/5 p-4 transition-all hover:border-white/20 hover:bg-white/10"
        @click="goToUserDetail(u)"
      >
        <!-- Email -->
        <div class="flex items-start justify-between">
          <div class="flex-1 min-w-0">
            <h3 class="font-medium truncate text-base">{{ u.email }}</h3>
            <p v-if="u.displayName" class="text-sm text-gray-400 truncate mt-0.5">{{ u.displayName }}</p>
          </div>
        </div>

        <!-- Last login -->
        <div class="mt-2 text-xs text-gray-500">
          <span class="font-medium">{{ t('settings.users.lastLogin') }}:</span>
          <span class="ml-1">{{ formatRelativeTime(u.lastLogin) }}</span>
        </div>

        <!-- Roles and Auth modes -->
        <div class="mt-3 flex flex-wrap gap-2">
          <!-- Role badges -->
          <span
            v-for="role in (u.roles || [])"
            :key="role"
            :class="[
              'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
              role === 'admin'
                ? 'bg-accent/20 text-accent border border-accent/30'
                : 'bg-gray-500/20 text-gray-300 border border-gray-500/30'
            ]"
          >
            {{ role }}
          </span>

          <!-- Auth mode badges -->
          <span
            v-for="authMode in formatAuthModes(u.authModes)"
            :key="authMode.label"
            :class="[
              'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
              authMode.type === 'local'
                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                : authMode.type === 'oidc'
                ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                : 'bg-gray-600/20 text-gray-400 border border-gray-600/30'
            ]"
          >
            {{ authMode.label }}
          </span>
        </div>
      </div>
    </div>

    <!-- Create user modal -->
    <div
      v-if="showCreateModal"
      class="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
      role="dialog"
      aria-modal="true"
    >
      <div class="fixed inset-0 bg-black/50" @click="closeCreateModal"></div>
      <div class="relative z-10 w-full max-w-3xl overflow-hidden rounded-lg border border-white/10 bg-white/90 p-6 shadow-xl dark:border-white/10 dark:bg-zinc-900/90">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-semibold">{{ t('settings.users.createUser') }}</h3>
          <button
            type="button"
            class="text-neutral-500 hover:text-neutral-300"
            :aria-label="t('common.dismiss')"
            @click="closeCreateModal"
          >
            &times;
          </button>
        </div>
        <form class="mt-4 space-y-4" @submit.prevent="handleCreate">
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <label class="block text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{{ t('settings.users.email') }} *</label>
              <input
                v-model.trim="newEmail"
                type="email"
                :placeholder="t('settings.users.emailPlaceholder')"
                class="w-full rounded-md border border-white/10 bg-transparent px-2 py-1"
              />
            </div>
            <div>
              <label class="block text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{{ t('settings.users.username') }}</label>
              <input
                v-model.trim="newUsername"
                :placeholder="t('settings.users.usernameOptional')"
                class="w-full rounded-md border border-white/10 bg-transparent px-2 py-1"
              />
            </div>
            <div>
              <label class="block text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{{ t('settings.users.password') }} *</label>
              <input
                v-model="newPassword"
                type="password"
                placeholder="••••••"
                class="w-full rounded-md border border-white/10 bg-transparent px-2 py-1"
              />
            </div>
            <div class="flex items-end">
              <label class="inline-flex items-center gap-2">
                <input type="checkbox" v-model="newIsAdmin" />
                <span>{{ t('settings.users.grantAdmin') }}</span>
              </label>
            </div>
          </div>
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="rounded-md border border-white/10 px-3 py-1 text-sm text-white hover:bg-white/5"
              @click="closeCreateModal"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              type="submit"
              :disabled="creating"
              class="rounded-md bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-500 disabled:opacity-60"
            >
              {{ creating ? t('settings.users.creating') : t('common.create') }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
