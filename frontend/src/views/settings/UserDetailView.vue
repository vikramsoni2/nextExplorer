<script setup>
import { onMounted, ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  fetchUserById,
  fetchUserVolumes,
  updateUser,
  adminSetUserPassword,
  assignUserVolume,
  removeUserVolume,
  updateUserRoles
} from '@/api';
import DirectoryBrowser from '@/components/DirectoryBrowser.vue';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();

const userId = computed(() => route.params.id);
const user = ref(null);
const volumes = ref([]);
const loading = ref(false);
const loadingVolumes = ref(false);
const errorMsg = ref('');

// Profile editing
const editingProfile = ref(false);
const editEmail = ref('');
const editUsername = ref('');
const editDisplayName = ref('');
const savingProfile = ref(false);

// Volume browser
const showVolumeBrowser = ref(false);

// Load user details
const loadUser = async () => {
  loading.value = true;
  errorMsg.value = '';
  try {
    const res = await fetchUserById(userId.value);
    user.value = res?.user || null;

    if (user.value) {
      editEmail.value = user.value.email || '';
      editUsername.value = user.value.username || '';
      editDisplayName.value = user.value.displayName || '';
    }
  } catch (e) {
    errorMsg.value = e?.message || t('settings.users.failedLoad');
  } finally {
    loading.value = false;
  }
};

// Load user volumes
const loadVolumes = async () => {
  loadingVolumes.value = true;
  try {
    const res = await fetchUserVolumes(userId.value);
    volumes.value = res?.volumes || [];
  } catch (e) {
    console.error('Failed to load volumes:', e);
  } finally {
    loadingVolumes.value = false;
  }
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

// Format date
const formatDate = (isoString) => {
  if (!isoString) return '—';
  const date = new Date(isoString);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
};

// Toggle profile editing
const toggleProfileEdit = () => {
  editingProfile.value = !editingProfile.value;
  if (editingProfile.value && user.value) {
    editEmail.value = user.value.email || '';
    editUsername.value = user.value.username || '';
    editDisplayName.value = user.value.displayName || '';
  }
};

// Save profile
const saveProfile = async () => {
  if (!editEmail.value.trim()) {
    alert(t('auth.errors.emailRequired'));
    return;
  }

  savingProfile.value = true;
  try {
    const res = await updateUser(userId.value, {
      email: editEmail.value.trim(),
      username: editUsername.value.trim(),
      displayName: editDisplayName.value.trim()
    });

    if (res?.user) {
      user.value = { ...user.value, ...res.user };
      editingProfile.value = false;
    }
  } catch (e) {
    alert(e?.message || t('settings.users.failedUpdate'));
  } finally {
    savingProfile.value = false;
  }
};

// Reset password
const handleResetPassword = async () => {
  const pwd = window.prompt(t('settings.users.promptNewPassword', { user: user.value.username || user.value.email }));
  if (pwd == null) return;
  if (pwd.length < 6) {
    alert(t('settings.users.passwordMin'));
    return;
  }

  try {
    await adminSetUserPassword(userId.value, pwd);
    alert(t('settings.users.passwordUpdated'));
  } catch (e) {
    alert(e?.message || t('settings.users.failedReset'));
  }
};

// Toggle admin role
const toggleAdminRole = async () => {
  const currentRoles = user.value?.roles || [];
  const isAdmin = currentRoles.includes('admin');

  const nextRoles = isAdmin
    ? currentRoles.filter(r => r !== 'admin')
    : [...currentRoles, 'admin'];

  try {
    const res = await updateUserRoles(userId.value, nextRoles);
    if (res?.user) {
      user.value = { ...user.value, roles: res.user.roles };
    }
  } catch (e) {
    alert(e?.message || t('settings.users.failedUpdateRoles'));
  }
};

// Handle volume selected
const handleVolumeSelected = async ({ path, name }) => {
  try {
    await assignUserVolume(userId.value, {
      volumePath: path,
      volumeName: name
    });
    await loadVolumes();
    showVolumeBrowser.value = false;
  } catch (e) {
    alert(e?.message || t('settings.users.volumes.failedAssign'));
  }
};

// Remove volume
const handleRemoveVolume = async (volume) => {
  const ok = window.confirm(`Remove volume "${volume.volume_name}"?`);
  if (!ok) return;

  try {
    await removeUserVolume(userId.value, volume.id);
    volumes.value = volumes.value.filter(v => v.id !== volume.id);
  } catch (e) {
    alert(e?.message || t('settings.users.volumes.failedRemove'));
  }
};

// Go back
const goBack = () => {
  router.push('/settings/admin-users');
};

onMounted(() => {
  loadUser();
  loadVolumes();
});
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center gap-3">
      <button
        type="button"
        class="rounded-md border border-white/10 px-3 py-1.5 text-sm hover:bg-white/5"
        @click="goBack"
      >
        ← Back
      </button>
      <h2 class="text-lg font-semibold">{{ t('settings.users.detail.title') }}</h2>
      <span v-if="loading" class="text-sm opacity-75">{{ t('common.loading') }}…</span>
    </div>

    <p v-if="errorMsg" class="text-sm text-red-500">{{ errorMsg }}</p>

    <div v-if="user" class="space-y-6">
      <!-- Profile Section -->
      <div class="rounded-lg border border-white/10 bg-white/5 p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-base font-semibold">{{ t('settings.users.detail.profile') }}</h3>
          <button
            v-if="!editingProfile"
            type="button"
            class="rounded-md border border-white/10 px-3 py-1 text-sm hover:bg-white/5"
            @click="toggleProfileEdit"
          >
            {{ t('common.edit') }}
          </button>
        </div>

        <div v-if="!editingProfile" class="space-y-3 text-sm">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <span class="text-gray-400">{{ t('settings.users.email') }}:</span>
              <span class="ml-2">{{ user.email }}</span>
            </div>
            <div>
              <span class="text-gray-400">{{ t('settings.users.username') }}:</span>
              <span class="ml-2">{{ user.username || '—' }}</span>
            </div>
            <div>
              <span class="text-gray-400">{{ t('settings.users.displayName') }}:</span>
              <span class="ml-2">{{ user.displayName || '—' }}</span>
            </div>
            <div>
              <span class="text-gray-400">{{ t('settings.users.lastLogin') }}:</span>
              <span class="ml-2">{{ formatRelativeTime(user.lastLogin) }}</span>
            </div>
            <div>
              <span class="text-gray-400">{{ t('settings.users.detail.createdAt') }}:</span>
              <span class="ml-2">{{ formatDate(user.createdAt) }}</span>
            </div>
            <div>
              <span class="text-gray-400">{{ t('settings.users.detail.updatedAt') }}:</span>
              <span class="ml-2">{{ formatDate(user.updatedAt) }}</span>
            </div>
          </div>

          <div class="mt-4">
            <span class="text-gray-400">{{ t('settings.users.roles') }}:</span>
            <div class="mt-2 flex flex-wrap gap-2">
              <span
                v-for="role in (user.roles || [])"
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
              <button
                type="button"
                class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium border border-white/20 hover:bg-white/10"
                @click="toggleAdminRole"
              >
                {{ (user.roles || []).includes('admin') ? 'Remove admin' : 'Make admin' }}
              </button>
            </div>
          </div>
        </div>

        <form v-else class="space-y-4" @submit.prevent="saveProfile">
          <div>
            <label class="block text-xs uppercase tracking-wide text-neutral-400 mb-1">
              {{ t('settings.users.email') }} *
            </label>
            <input
              v-model.trim="editEmail"
              type="email"
              class="w-full rounded-md border border-white/10 bg-transparent px-3 py-1.5"
            />
          </div>
          <div>
            <label class="block text-xs uppercase tracking-wide text-neutral-400 mb-1">
              {{ t('settings.users.username') }}
            </label>
            <input
              v-model.trim="editUsername"
              type="text"
              class="w-full rounded-md border border-white/10 bg-transparent px-3 py-1.5"
            />
          </div>
          <div>
            <label class="block text-xs uppercase tracking-wide text-neutral-400 mb-1">
              {{ t('settings.users.displayName') }}
            </label>
            <input
              v-model.trim="editDisplayName"
              type="text"
              class="w-full rounded-md border border-white/10 bg-transparent px-3 py-1.5"
            />
          </div>
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="rounded-md border border-white/10 px-3 py-1 text-sm hover:bg-white/5"
              @click="toggleProfileEdit"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              type="submit"
              :disabled="savingProfile"
              class="rounded-md bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-500 disabled:opacity-60"
            >
              {{ savingProfile ? t('common.saving') : t('common.save') }}
            </button>
          </div>
        </form>
      </div>

      <!-- Auth Methods Section -->
      <div class="rounded-lg border border-white/10 bg-white/5 p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-base font-semibold">{{ t('settings.users.detail.authMethods') }}</h3>
          <button
            type="button"
            class="rounded-md border border-white/10 px-3 py-1 text-sm hover:bg-white/5"
            @click="handleResetPassword"
          >
            {{ t('settings.users.resetPassword') }}
          </button>
        </div>

        <div v-if="user.authMethods && user.authMethods.length > 0" class="space-y-3">
          <div
            v-for="method in user.authMethods"
            :key="method.id"
            class="flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-4 py-3"
          >
            <div>
              <div class="font-medium">
                {{ method.methodType === 'local_password' ? 'Local Password' : method.providerName || 'OIDC' }}
              </div>
              <div class="text-xs text-gray-400 mt-1">
                {{ t('settings.users.lastLogin') }}: {{ formatRelativeTime(method.lastUsedAt) }}
              </div>
            </div>
            <span
              :class="[
                'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
                method.methodType === 'local_password'
                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                  : 'bg-green-500/20 text-green-300 border border-green-500/30'
              ]"
            >
              {{ method.methodType === 'local_password' ? 'Local' : 'OIDC' }}
            </span>
          </div>
        </div>
        <div v-else class="text-sm text-gray-400">
          {{ t('settings.users.noAuthMethods') }}
        </div>
      </div>

      <!-- Volumes Section -->
      <div class="rounded-lg border border-white/10 bg-white/5 p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-base font-semibold">{{ t('settings.users.detail.volumes') }}</h3>
          <button
            type="button"
            class="rounded-md bg-accent px-3 py-1 text-sm font-medium text-black hover:bg-accent/90"
            @click="showVolumeBrowser = true"
          >
            {{ t('settings.users.volumes.addVolume') }}
          </button>
        </div>

        <div v-if="loadingVolumes" class="text-sm text-gray-400">
          {{ t('common.loading') }}…
        </div>

        <div v-else-if="volumes.length > 0" class="space-y-2">
          <div
            v-for="volume in volumes"
            :key="volume.id"
            class="flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-4 py-3"
          >
            <div class="flex-1 min-w-0">
              <div class="font-medium truncate">{{ volume.volume_name }}</div>
              <div class="text-xs text-gray-400 truncate mt-1">{{ volume.volume_path }}</div>
            </div>
            <button
              type="button"
              class="ml-4 rounded-md border border-red-400 px-3 py-1 text-xs text-red-300 hover:bg-red-500/10"
              @click="handleRemoveVolume(volume)"
            >
              {{ t('settings.users.volumes.removeVolume') }}
            </button>
          </div>
        </div>

        <div v-else class="text-center py-8">
          <p class="text-sm text-gray-400">{{ t('settings.users.volumes.empty') }}</p>
          <p class="text-xs text-gray-500 mt-1">{{ t('settings.users.volumes.emptyHint') }}</p>
        </div>
      </div>
    </div>

    <!-- Directory Browser Modal -->
    <DirectoryBrowser
      v-if="showVolumeBrowser"
      @close="showVolumeBrowser = false"
      @select="handleVolumeSelected"
    />
  </div>
</template>
