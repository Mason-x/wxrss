<template>
  <div class="flex h-full flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
    <Teleport defer to="#title">
      <h1 class="text-[28px] font-bold leading-[34px] text-slate-900 dark:text-slate-50">用户管理</h1>
    </Teleport>

    <div class="min-h-0 flex-1 overflow-y-auto py-4 md:py-6">
      <div class="mx-auto max-w-6xl space-y-6 px-4 md:px-6">
        <section class="grid gap-4 md:grid-cols-3">
          <UCard>
            <p class="text-sm text-slate-500 dark:text-slate-400">总用户数</p>
            <p class="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">{{ users.length }}</p>
          </UCard>
          <UCard>
            <p class="text-sm text-slate-500 dark:text-slate-400">已禁用</p>
            <p class="mt-2 text-2xl font-semibold text-rose-600 dark:text-rose-300">{{ disabledCount }}</p>
          </UCard>
          <UCard>
            <p class="text-sm text-slate-500 dark:text-slate-400">管理员</p>
            <p class="mt-2 text-2xl font-semibold text-emerald-600 dark:text-emerald-300">{{ adminCount }}</p>
          </UCard>
        </section>

        <UCard>
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 class="text-xl font-semibold">已登录公众号</h2>
                <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  管理员由环境变量 <code class="font-mono text-xs">MP_ADMIN_IDENTITY_KEY</code> 指定。
                </p>
              </div>
              <UButton color="gray" variant="soft" icon="i-lucide:refresh-cw" :loading="loading" @click="loadUsers">
                刷新
              </UButton>
            </div>
          </template>

          <div v-if="errorText" class="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
            {{ errorText }}
          </div>

          <div v-else-if="users.length === 0" class="rounded-[20px] border border-slate-200 bg-white/80 px-4 py-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
            还没有已识别的用户。
          </div>

          <div v-else class="space-y-3">
            <div
              v-for="user in users"
              :key="user.identityKey"
              class="rounded-[24px] border border-white/70 bg-white/80 p-4 shadow-[0_16px_30px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-slate-950/70"
            >
              <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div class="min-w-0 flex-1">
                  <div class="flex items-start gap-3">
                    <img
                      v-if="user.avatar"
                      :src="imageProxy + user.avatar"
                      alt=""
                      class="size-12 rounded-full ring-1 ring-white/80 dark:ring-slate-700"
                    />
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-2">
                        <p class="truncate text-base font-semibold text-slate-900 dark:text-slate-100">
                          {{ user.nickname || user.alias || user.userName || '未命名公众号' }}
                        </p>
                        <UBadge :color="user.role === 'admin' ? 'emerald' : 'gray'" variant="subtle">
                          {{ user.role === 'admin' ? '管理员' : '普通用户' }}
                        </UBadge>
                        <UBadge v-if="user.disabled" color="rose" variant="subtle">已禁用</UBadge>
                        <UBadge v-if="user.isCurrentUser" color="sky" variant="subtle">当前登录</UBadge>
                      </div>
                      <div class="mt-2 grid gap-2 text-xs text-slate-500 dark:text-slate-400 md:grid-cols-2">
                        <p class="truncate"><span class="font-medium">Identity:</span> {{ user.identityKey }}</p>
                        <p><span class="font-medium">最近登录:</span> {{ formatTimestamp(user.lastLoginAt) }}</p>
                        <p v-if="user.memberCount > 1"><span class="font-medium">关联记录:</span> {{ user.memberCount }}</p>
                        <p v-if="user.bizUin"><span class="font-medium">BizUin:</span> {{ user.bizUin }}</p>
                        <p v-if="user.alias"><span class="font-medium">Alias:</span> {{ user.alias }}</p>
                        <p v-if="user.userName"><span class="font-medium">UserName:</span> {{ user.userName }}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="flex flex-wrap items-center gap-2 md:justify-end">
                  <UButton size="sm" color="gray" variant="soft" icon="i-lucide:copy" @click="copyIdentityKey(user)">
                    复制 Identity
                  </UButton>
                  <UButton
                    size="sm"
                    :color="user.disabled ? 'emerald' : 'rose'"
                    :variant="user.disabled ? 'soft' : 'solid'"
                    :loading="pendingActionIdentityKey === `status:${user.identityKey}`"
                    :disabled="user.role === 'admin'"
                    @click="toggleUserStatus(user)"
                  >
                    {{ user.disabled ? '解禁登录' : '禁止登录' }}
                  </UButton>
                  <UButton
                    size="sm"
                    color="rose"
                    variant="soft"
                    icon="i-lucide:trash-2"
                    :loading="pendingActionIdentityKey === `delete:${user.identityKey}`"
                    :disabled="user.role === 'admin'"
                    @click="deleteUser(user)"
                  >
                    删除用户
                  </UButton>
                </div>
              </div>
            </div>
          </div>
        </UCard>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { request } from '#shared/utils/request';
import toastFactory from '~/composables/toast';
import { IMAGE_PROXY, websiteName } from '~/config';

interface AdminUserItem {
  identityKey: string;
  identityKeys: string[];
  memberCount: number;
  nickname: string;
  avatar: string;
  userName: string;
  bizUin: string;
  alias: string;
  lastLoginAt: number;
  disabled: boolean;
  disabledAt: number;
  role: 'admin' | 'user';
  isCurrentUser: boolean;
}

useHead({
  title: `用户管理 | ${websiteName}`,
});

const toast = toastFactory();
const imageProxy = IMAGE_PROXY;
const users = ref<AdminUserItem[]>([]);
const loading = ref(false);
const pendingActionIdentityKey = ref('');
const errorText = ref('');

const disabledCount = computed(() => users.value.filter(user => user.disabled).length);
const adminCount = computed(() => users.value.filter(user => user.role === 'admin').length);

function formatTimestamp(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '未记录';
  }
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

async function loadUsers() {
  loading.value = true;
  errorText.value = '';

  try {
    const response = await request<{ data?: AdminUserItem[] }>('/api/web/admin/users');
    users.value = Array.isArray(response?.data) ? response.data : [];
  } catch (error: any) {
    errorText.value = String(error?.data?.statusMessage || error?.statusMessage || error?.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

async function copyIdentityKey(user: AdminUserItem) {
  try {
    await navigator.clipboard.writeText(user.identityKey);
    toast.success('已复制 Identity Key');
  } catch {
    toast.error('复制失败');
  }
}

async function toggleUserStatus(user: AdminUserItem) {
  if (user.role === 'admin') {
    return;
  }

  pendingActionIdentityKey.value = `status:${user.identityKey}`;
  try {
    await request(`/api/web/admin/users/${encodeURIComponent(user.identityKey)}/status`, {
      method: 'POST',
      body: {
        disabled: !user.disabled,
      },
    });
    toast.success(user.disabled ? '已允许登录' : '已禁止登录');
    await loadUsers();
  } catch (error: any) {
    toast.error(String(error?.data?.statusMessage || error?.statusMessage || error?.message || '更新失败'));
  } finally {
    pendingActionIdentityKey.value = '';
  }
}

async function deleteUser(user: AdminUserItem) {
  if (user.role === 'admin') {
    return;
  }

  const displayName = user.nickname || user.alias || user.userName || user.identityKey;
  const confirmed = window.confirm(
    `确认删除用户“${displayName}”吗？这会清空该用户关联的登录身份、设置、订阅、文章和缓存数据，且无法恢复。`
  );
  if (!confirmed) {
    return;
  }

  pendingActionIdentityKey.value = `delete:${user.identityKey}`;
  try {
    await request(`/api/web/admin/users/${encodeURIComponent(user.identityKey)}/delete`, {
      method: 'POST',
    });
    toast.success('已删除用户');
    await loadUsers();
  } catch (error: any) {
    toast.error(String(error?.data?.statusMessage || error?.statusMessage || error?.message || '删除失败'));
  } finally {
    pendingActionIdentityKey.value = '';
  }
}

onMounted(() => {
  void loadUsers();
});
</script>
