<template>
  <div class="flex h-full flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
    <Teleport defer to="#title">
      <h1 class="text-[28px] font-bold leading-[34px] text-slate-12 dark:text-slate-50">公共代理</h1>
    </Teleport>

    <header class="border-b border-slate-200 px-4 py-4 dark:border-slate-800 md:px-6 md:py-5">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 class="text-xl font-semibold md:text-2xl">节点概览</h2>
            <p class="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
              公共代理资源有限，请按需使用。大批量抓取建议优先自建私有代理节点。
            </p>
            <p class="mt-2 text-sm leading-6 text-rose-500">
              如果个别 IP 滥用公共代理，可能导致微信侧封禁或限流，届时整组节点都会受影响。
            </p>
          </div>

          <div class="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/80 md:min-w-[260px]">
            <div>
              <p class="text-sm text-slate-500 dark:text-slate-400">可用节点</p>
              <p class="mt-1 text-lg font-semibold text-emerald-600">{{ totalSuccess }}</p>
            </div>
            <div class="text-right">
              <p class="text-sm text-slate-500 dark:text-slate-400">不可用节点</p>
              <p class="mt-1 text-lg font-semibold text-rose-500">{{ totalFailure }}</p>
            </div>
          </div>
        </div>

        <div class="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/80 md:flex-row md:items-center md:justify-between">
          <div class="min-w-0">
            <p class="text-sm text-slate-500 dark:text-slate-400">当前出口 IP</p>
            <code class="mt-1 block truncate text-sm font-semibold" :class="hasBlocked ? 'text-rose-500' : 'text-emerald-500'">
              {{ currentIP || '--' }}
            </code>
          </div>

          <UPopover :popper="{ placement: 'bottom-end', arrow: true }">
            <UButton
              :icon="hasBlocked ? 'i-lucide:shield-alert' : 'i-lucide:shield-check'"
              :color="hasBlocked ? 'rose' : 'green'"
              variant="soft"
            >
              {{ hasBlocked ? '当前 IP 已封禁' : '封禁列表' }}
            </UButton>

            <template #panel>
              <div class="max-h-80 w-[min(22rem,80vw)] space-y-3 overflow-y-auto p-4">
                <div>
                  <p class="text-sm font-medium">当前出口 IP</p>
                  <code class="mt-1 block text-sm" :class="hasBlocked ? 'text-rose-500' : 'text-emerald-500'">
                    {{ currentIP || '--' }}
                  </code>
                </div>
                <div>
                  <p class="flex items-center justify-between gap-3 text-sm font-medium">
                    <span>已封禁 IP</span>
                    <span class="text-xs text-slate-400">如存在误封，请联系维护者处理。</span>
                  </p>
                  <ul v-if="blockedIPS.length" class="mt-2 space-y-1">
                    <li v-for="ip in blockedIPS" :key="ip">
                      <code class="text-sm text-rose-500">{{ ip }}</code>
                    </li>
                  </ul>
                  <p v-else class="mt-2 text-sm text-slate-500 dark:text-slate-400">当前没有封禁记录。</p>
                </div>
              </div>
            </template>
          </UPopover>
        </div>
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
      <div v-if="loading" class="flex items-center justify-center py-10">
        <Loader :size="28" class="animate-spin text-slate-500" />
      </div>
      <ProxyMetrics v-else :data="metricsData" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Loader } from 'lucide-vue-next';
import { websiteName } from '~/config';
import type { AccountMetric } from '~/types/proxy';
import ProxyMetrics from '~/components/ProxyMetrics.vue';
import { request } from '#shared/utils/request';

useHead({
  title: `公共代理 | ${websiteName}`,
});

const loading = ref(false);
const metricsData = ref<AccountMetric[]>([]);

const totalSuccess = computed(
  () => metricsData.value.filter(item => item.metric && item.metric.dailyRequests < 100_000).length
);
const totalFailure = computed(
  () => metricsData.value.filter(item => item.metric && item.metric.dailyRequests >= 100_000).length
);

async function getMetricsData() {
  loading.value = true;
  try {
    metricsData.value = await fetch('/api/web/worker/overview-metrics')
      .then(res => res.json())
      .catch(error => {
        throw error;
      });
  } catch (error) {
    console.error(error);
  } finally {
    loading.value = false;
  }
}

const currentIP = ref('');
const blockedIPS = ref<string[]>([]);

onMounted(async () => {
  await Promise.all([
    getMetricsData(),
    request('/api/web/misc/current-ip').then(data => {
      currentIP.value = data.ip;
    }),
    request<string[]>('/api/web/worker/blocked-ip-list').then(data => {
      blockedIPS.value = data;
    }),
  ]);
});

const hasBlocked = computed(() => blockedIPS.value.includes(currentIP.value));
</script>
