<template>
  <UCard class="app-shell-panel h-full overflow-hidden rounded-[30px]" :ui="cardUi">
    <template #header>
      <h3 class="text-xl font-semibold md:text-2xl">每日自动同步</h3>
      <p class="text-sm text-slate-500">由服务端定时执行同步任务，页面无需保持打开。</p>
    </template>

    <div class="space-y-4">
      <div class="app-shell-muted rounded-[26px] p-4 sm:p-5">
        <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div class="min-w-0">
            <UCheckbox
              v-model="preferences.dailySyncEnabled"
              name="dailySyncEnabled"
              label="启用每日自动同步全部公众号"
            />
            <p class="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
              开启后，系统会按设定时间自动执行一次“全部公众号同步”。
            </p>
          </div>

          <div class="w-full md:w-[180px]">
            <p class="mb-1 text-sm font-medium">执行时间</p>
            <UInput
              v-model="preferences.dailySyncTime"
              type="time"
              class="font-mono"
              :disabled="!preferences.dailySyncEnabled"
              @blur="normalizeDailySyncTime"
            />
          </div>
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <div class="rounded-[22px] border border-white/75 bg-white/80 px-4 py-3 shadow-[0_14px_28px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-slate-900/80">
          <p class="text-xs text-slate-500 dark:text-slate-400">执行方式</p>
          <p class="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">服务端定时任务</p>
        </div>
        <div class="rounded-[22px] border border-white/75 bg-white/80 px-4 py-3 shadow-[0_14px_28px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-slate-900/80">
          <p class="text-xs text-slate-500 dark:text-slate-400">页面要求</p>
          <p class="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">无需持续打开</p>
        </div>
      </div>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import type { Preferences } from '~/types/preferences';

const preferences: Ref<Preferences> = usePreferences() as unknown as Ref<Preferences>;
const cardUi = {
  ring: '',
  divide: 'divide-y divide-slate-200/70 dark:divide-slate-800/80',
  header: { padding: 'px-5 pb-0 pt-5 sm:px-6 sm:pt-6' },
  body: { padding: 'px-5 pb-5 pt-5 sm:px-6 sm:pb-6 sm:pt-5' },
};

function normalizeDailySyncTime() {
  const raw = String(preferences.value.dailySyncTime || '').trim();
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(raw);
  preferences.value.dailySyncTime = match ? `${match[1]}:${match[2]}` : '06:00';
}
</script>
