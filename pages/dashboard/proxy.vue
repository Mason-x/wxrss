<template>
  <div class="flex h-full flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
    <Teleport defer to="#title">
      <h1 class="text-[28px] font-bold leading-[34px] text-slate-12 dark:text-slate-50">私有代理</h1>
    </Teleport>

    <div class="min-h-0 flex-1 overflow-y-auto py-4 md:py-6">
      <div class="mx-auto max-w-6xl space-y-6 px-4 md:px-6">
        <section class="grid gap-4 lg:grid-cols-4">
          <UCard>
            <p class="text-sm text-slate-500 dark:text-slate-400">已配置节点</p>
            <p class="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">{{ proxyCount }}</p>
          </UCard>

          <UCard>
            <p class="text-sm text-slate-500 dark:text-slate-400">工作模式</p>
            <p class="mt-2 text-2xl font-semibold text-emerald-600">仅私有代理</p>
          </UCard>

          <UCard>
            <p class="text-sm text-slate-500 dark:text-slate-400">公共代理遥测</p>
            <p class="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">已停用</p>
          </UCard>

          <UCard>
            <p class="text-sm text-slate-500 dark:text-slate-400">黑名单回传</p>
            <p class="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">已停用</p>
          </UCard>
        </section>

        <UCard>
          <template #header>
            <h2 class="text-xl font-semibold">当前状态</h2>
          </template>

          <div class="space-y-4 text-sm leading-7 text-slate-600 dark:text-slate-300">
            <p>
              本页面不再读取公共代理出口 IP、不再拉取封禁列表，也不会向原项目的公共代理节点或外部 Deno Deploy
              服务上报任何部署域名、来源 IP 或使用统计。
            </p>
            <p>
              文章抓取、资源下载和导出现在只会使用你在本地设置中保存的私有代理地址；如果没有配置私有代理，相关任务会直接停止。
            </p>

            <div v-if="proxyCount > 0" class="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
              <p class="font-medium text-slate-900 dark:text-slate-100">生效中的私有代理</p>
              <ul class="mt-3 space-y-2 font-mono text-xs md:text-sm">
                <li v-for="proxy in proxyState.proxies" :key="proxy">{{ proxy }}</li>
              </ul>
            </div>

            <div v-else class="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              尚未配置私有代理。为避免任何请求落到公共代理，抓取和导出功能会保持禁用状态。
            </div>
          </div>
        </UCard>

        <SettingProxy />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import SettingProxy from '~/components/setting/Proxy.vue';
import { websiteName } from '~/config';
import { validatePrivateProxyList } from '~/config/proxy';
import type { Preferences } from '~/types/preferences';

useHead({
  title: `私有代理 | ${websiteName}`,
});

const preferences: Ref<Preferences> = usePreferences() as unknown as Ref<Preferences>;

const proxyState = computed(() => validatePrivateProxyList(preferences.value.privateProxyList || []));
const proxyCount = computed(() => proxyState.value.proxies.length);
</script>
