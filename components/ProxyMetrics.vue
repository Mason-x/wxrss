<template>
  <div class="grid gap-4 lg:grid-cols-2">
    <div
      v-for="account in accountMetrics"
      :key="account.name"
      class="relative rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_14px_34px_rgba(15,23,42,0.06)] transition-shadow hover:shadow-[0_18px_40px_rgba(15,23,42,0.1)] dark:border-slate-800 dark:bg-slate-900 md:p-5"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="truncate text-lg font-semibold text-slate-700 dark:text-slate-100" :title="account.name">
            节点：{{ account.domain }}
          </h3>
          <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">点击右上角可以复制节点地址或查看使用统计。</p>
        </div>

        <div class="flex shrink-0 items-center gap-3">
          <div class="size-5">
            <UIcon
              v-if="account.copied"
              name="i-lucide:check"
              class="size-5 cursor-pointer text-emerald-500"
            />
            <UTooltip v-else text="复制节点地址">
              <UIcon
                name="i-lucide:copy"
                class="size-5 cursor-pointer text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                @click="copyAddress(account)"
              />
            </UTooltip>
          </div>
        </div>
      </div>

      <div class="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-800 dark:bg-slate-950/60">
        <UMeter v-if="account.metric" :value="account.metric.dailyRequests" :max="100_000" color="orange">
          <template #indicator>
            <div class="flex items-center justify-between gap-3 text-sm text-slate-500 dark:text-slate-400">
              <span>今日请求量</span>
              <p class="text-right">
                <span class="text-base font-semibold text-emerald-500">
                  {{ Math.round((Math.min(account.metric.dailyRequests, 100_000) / 100_000) * 100) }}%
                </span>
                <span class="ml-2 font-mono text-xs">
                  ({{ account.metric.dailyRequests.toLocaleString('en-US') }}/{{ (100_000).toLocaleString('en-US') }})
                </span>
              </p>
            </div>
          </template>
        </UMeter>
        <p v-else class="text-sm text-slate-500 dark:text-slate-400">当前没有可用的统计数据。</p>
      </div>

      <div class="mt-5">
        <header class="mb-3 flex items-center justify-between gap-3">
          <h3 class="text-sm font-medium text-slate-500 dark:text-slate-400">节点使用详情</h3>
          <div class="size-5">
            <UIcon
              v-if="account.fetchAnalyticsLoading"
              name="i-lucide:loader"
              class="size-5 animate-spin text-slate-400"
            />
            <UTooltip v-else text="查看节点使用详情">
              <UIcon
                name="i-lucide:activity"
                class="size-5 cursor-pointer text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                @click="nodeAnalytics(account)"
              />
            </UTooltip>
          </div>
        </header>

        <div v-if="account.topClientIPs.length" class="space-y-2">
          <div
            v-for="item in account.topClientIPs"
            :key="item.clientIP"
            class="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/60"
          >
            <div class="absolute inset-y-0 left-0 rounded-l-xl bg-blue-600/14" :style="{ width: account.total ? (item.count / account.total) * 100 + '%' : '0%' }" />
            <div class="relative z-10 flex items-center justify-between gap-3">
              <p class="truncate font-mono text-xs text-slate-600 dark:text-slate-300">{{ item.clientIP }}</p>
              <p class="shrink-0 font-mono text-xs text-slate-500 dark:text-slate-400">
                {{ item.count > 1000 ? (item.count / 1000).toFixed(2) + 'k' : item.count }}
              </p>
            </div>
          </div>
        </div>
        <p v-else class="text-sm text-slate-500 dark:text-slate-400">尚未加载节点使用详情。</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AccountMetric } from '~/types/proxy';
import { request } from '#shared/utils/request';

interface Props {
  data: AccountMetric[];
}
interface AccountMetricWithExtra extends AccountMetric {
  copied: boolean;
  fetchAnalyticsLoading: boolean;
  topClientIPs: Security[];
  total: number;
}
interface Security {
  clientIP: string;
  count: number;
}

const props = defineProps<Props>();

const accountMetrics: AccountMetricWithExtra[] = reactive(
  props.data.map((account: AccountMetric) => ({
    ...account,
    copied: false,
    fetchAnalyticsLoading: false,
    topClientIPs: [],
    total: 0,
  }))
);

watch(
  () => props.data,
  () => {
    Object.assign(
      accountMetrics,
      props.data.map((account: AccountMetric) => ({
        ...account,
        copied: false,
        fetchAnalyticsLoading: false,
        topClientIPs: [],
        total: 0,
      }))
    );
  }
);

function copyAddress(account: AccountMetricWithExtra) {
  const result: string[] = [];
  for (let i = 0; i < 16; i++) {
    result.push(`https://${('0' + i).slice(-2)}${account.domain.replace(/^\*/, '')}`);
  }
  navigator.clipboard.writeText(result.join('\n'));

  account.copied = true;
  setTimeout(() => {
    account.copied = false;
  }, 1000);
}

async function nodeAnalytics(account: AccountMetricWithExtra) {
  account.fetchAnalyticsLoading = true;
  const resp = await request('/api/web/worker/security-top-n', {
    method: 'GET',
    query: {
      name: account.name,
    },
  }).finally(() => {
    account.fetchAnalyticsLoading = false;
  });
  account.topClientIPs = resp.topClientIPs;
  account.total = resp.total;
}
</script>
