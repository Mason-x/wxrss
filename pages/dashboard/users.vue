<template>
  <div class="flex h-full flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
    <Teleport defer to="#title">
      <h1 class="text-2xl font-bold leading-8 text-slate-900 dark:text-slate-50 md:text-[28px] md:leading-[34px]">
        用户管理
      </h1>
    </Teleport>

    <div class="min-h-0 flex-1 overflow-y-auto py-4 md:py-6">
      <div class="mx-auto max-w-6xl space-y-4 px-4 md:space-y-6 md:px-6">
        <section class="grid grid-cols-3 gap-3 md:gap-4">
          <div
            class="rounded-[24px] border border-white/70 bg-white/85 p-4 shadow-[0_16px_28px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-slate-950/70"
          >
            <p class="text-xs font-medium tracking-[0.08em] text-slate-500 dark:text-slate-400 md:text-sm">总用户数</p>
            <p class="mt-3 text-2xl font-semibold text-slate-900 dark:text-slate-100">{{ users.length }}</p>
          </div>
          <div
            class="rounded-[24px] border border-white/70 bg-white/85 p-4 shadow-[0_16px_28px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-slate-950/70"
          >
            <p class="text-xs font-medium tracking-[0.08em] text-slate-500 dark:text-slate-400 md:text-sm">已禁用</p>
            <p class="mt-3 text-2xl font-semibold text-rose-600 dark:text-rose-300">{{ disabledCount }}</p>
          </div>
          <div
            class="rounded-[24px] border border-white/70 bg-white/85 p-4 shadow-[0_16px_28px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-slate-950/70"
          >
            <p class="text-xs font-medium tracking-[0.08em] text-slate-500 dark:text-slate-400 md:text-sm">管理员</p>
            <p class="mt-3 text-2xl font-semibold text-emerald-600 dark:text-emerald-300">{{ adminCount }}</p>
          </div>
        </section>

        <section
          class="overflow-hidden rounded-[28px] border border-white/70 bg-white/85 shadow-[0_24px_40px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-slate-950/70"
        >
          <div
            class="flex flex-col gap-3 border-b border-slate-200/70 px-4 py-4 dark:border-slate-800/80 md:flex-row md:items-center md:justify-between md:px-6"
          >
            <div class="min-w-0">
              <h2 class="text-xl font-semibold text-slate-900 dark:text-slate-100">用户列表</h2>
              <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">查看登录账号、禁用登录或删除用户数据。</p>
            </div>
            <UButton
              color="gray"
              variant="soft"
              icon="i-lucide:refresh-cw"
              :loading="loading"
              class="w-full justify-center md:w-auto"
              @click="loadUsers"
            >
              刷新
            </UButton>
          </div>

          <div class="p-4 md:p-6">
            <div
              v-if="errorText"
              class="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200"
            >
              {{ errorText }}
            </div>

            <div
              v-else-if="users.length === 0"
              class="rounded-[20px] border border-slate-200 bg-white/80 px-4 py-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400"
            >
              还没有已识别的用户。
            </div>

            <div v-else class="space-y-3">
              <div
                class="hidden grid-cols-[minmax(0,1.8fr)_140px_200px_320px] items-center gap-4 rounded-[20px] bg-slate-100/80 px-5 py-3 text-xs font-semibold tracking-[0.08em] text-slate-500 dark:bg-slate-900/70 dark:text-slate-400 md:grid"
              >
                <div>用户</div>
                <div>用户等级</div>
                <div>最近登录时间</div>
                <div class="text-right">操作</div>
              </div>

              <div
                v-for="user in users"
                :key="user.identityKey"
                class="rounded-[24px] border border-white/70 bg-white/90 p-4 shadow-[0_18px_30px_rgba(15,23,42,0.05)] transition-colors dark:border-white/10 dark:bg-slate-950/80 md:grid md:grid-cols-[minmax(0,1.8fr)_140px_200px_320px] md:items-center md:gap-4 md:px-5 md:py-4"
                :class="user.disabled ? 'border-rose-200/80 dark:border-rose-500/30' : ''"
              >
                <div class="flex items-center gap-3">
                  <img
                    v-if="user.avatar"
                    :src="imageProxy + user.avatar"
                    alt=""
                    class="size-12 shrink-0 rounded-full ring-1 ring-white/80 dark:ring-slate-700"
                  />
                  <div
                    v-else
                    class="flex size-12 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-400 ring-1 ring-white/80 dark:bg-slate-800 dark:text-slate-500 dark:ring-slate-700"
                  >
                    <UIcon name="i-lucide:user" class="size-5" />
                  </div>

                  <div class="min-w-0">
                    <div class="flex min-w-0 flex-wrap items-center gap-2">
                      <p class="truncate text-base font-semibold text-slate-900 dark:text-slate-100">
                        {{ getDisplayName(user) }}
                      </p>
                      <UBadge v-if="user.isCurrentUser" color="sky" variant="subtle">当前登录</UBadge>
                      <UBadge v-if="user.disabled" color="rose" variant="subtle">已禁用</UBadge>
                    </div>
                    <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      <template v-if="user.memberCount > 1">关联记录 {{ user.memberCount }}</template>
                      <template v-else>已识别公众号账号</template>
                    </p>
                  </div>
                </div>

                <div class="mt-4 md:mt-0">
                  <p class="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400 md:hidden">
                    用户等级
                  </p>
                  <UBadge :color="user.role === 'admin' ? 'emerald' : 'gray'" variant="subtle" size="lg">
                    {{ user.role === 'admin' ? '管理员' : '普通用户' }}
                  </UBadge>
                </div>

                <div class="mt-4 text-sm text-slate-600 dark:text-slate-300 md:mt-0">
                  <p class="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400 md:hidden">
                    最近登录时间
                  </p>
                  {{ formatTimestamp(user.lastLoginAt) }}
                </div>

                <div class="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3 md:mt-0">
                  <UButton
                    size="sm"
                    color="gray"
                    variant="soft"
                    icon="i-lucide:copy"
                    class="justify-center"
                    @click="copyIdentityKey(user)"
                  >
                    复制 ID
                  </UButton>
                  <UButton
                    size="sm"
                    :color="user.disabled ? 'emerald' : 'rose'"
                    :variant="user.disabled ? 'soft' : 'solid'"
                    :loading="pendingActionIdentityKey === `status:${user.identityKey}`"
                    :disabled="user.role === 'admin'"
                    class="justify-center"
                    @click="toggleUserStatus(user)"
                  >
                    {{ user.disabled ? '解除禁止' : '禁止登录' }}
                  </UButton>
                  <UButton
                    size="sm"
                    color="rose"
                    variant="soft"
                    icon="i-lucide:trash-2"
                    :loading="pendingActionIdentityKey === `delete:${user.identityKey}`"
                    :disabled="user.role === 'admin'"
                    class="justify-center"
                    @click="deleteUser(user)"
                  >
                    删除
                  </UButton>
                </div>
              </div>
            </div>
          </div>
        </section>
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

function getDisplayName(user: AdminUserItem) {
  return user.nickname || user.alias || user.userName || '未命名公众号';
}

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
    toast.success('已复制用户 ID');
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
    toast.success(user.disabled ? '已解除禁止登录' : '已禁止登录');
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

  const displayName = getDisplayName(user);
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
