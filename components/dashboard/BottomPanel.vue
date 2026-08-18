<script setup lang="ts">
import { request } from '#shared/utils/request';
import StorageUsage from '~/components/StorageUsage.vue';
import { IMAGE_PROXY } from '~/config';
import type { LogoutResponse } from '~/types/types';

const loginAccount = useLoginAccount();
const route = useRoute();
const { navigateToLogin } = useMpAuth();

function login() {
  void navigateToLogin(route.fullPath);
}

const logoutBtnLoading = ref(false);

async function logout() {
  logoutBtnLoading.value = true;
  const { statusCode, statusText } = await request<LogoutResponse>('/api/web/mp/logout');
  if (statusCode === 200) {
    loginAccount.value = null;
  } else {
    alert(statusText);
  }
  logoutBtnLoading.value = false;
}
</script>

<template>
  <footer class="space-y-3 border-t border-slate-200/70 pt-4 dark:border-slate-800/80">
    <div v-if="loginAccount" class="app-shell-muted space-y-3 rounded-[24px] p-3">
      <div class="flex items-center gap-3">
        <img
          v-if="loginAccount.avatar"
          :src="IMAGE_PROXY + loginAccount.avatar"
          alt=""
          class="size-10 rounded-full ring-1 ring-white/80 dark:ring-slate-700"
        />
        <UTooltip
          v-if="loginAccount.nickname"
          class="min-w-0 flex-1 overflow-hidden"
          :popper="{ placement: 'top-start', offsetDistance: 16 }"
        >
          <template #text>
            <span>{{ loginAccount.nickname }}</span>
          </template>
          <span class="whitespace-nowrap text-ellipsis overflow-hidden">{{ loginAccount.nickname }}</span>
        </UTooltip>

        <UButton
          icon="i-heroicons-arrow-left-start-on-rectangle-16-solid"
          :loading="logoutBtnLoading"
          color="gray"
          variant="ghost"
          class="rounded-full border border-white/70 bg-white/80 hover:bg-white dark:border-white/10 dark:bg-slate-900/80 dark:hover:bg-slate-900"
          @click="logout"
          >退出
        </UButton>
      </div>
      <div class="flex items-center justify-between gap-3 text-sm">
        <span>登录状态</span>
        <span class="font-mono text-green-500">已登录</span>
      </div>
    </div>
    <div v-else class="login-card app-shell-muted rounded-[24px] p-3">
      <UButton color="gray" variant="solid" @click="login">登录公众号</UButton>
    </div>
    <div class="app-shell-muted rounded-[24px] p-3">
      <StorageUsage />
    </div>
  </footer>
</template>

<style scoped>
.login-card :deep(button) {
  width: 100%;
  border-radius: 9999px;
}
</style>
