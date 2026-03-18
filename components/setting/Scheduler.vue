<template>
  <UCard class="app-shell-panel h-full overflow-hidden rounded-[30px]" :ui="cardUi">
    <template #header>
      <h3 class="text-xl font-semibold md:text-2xl">每日自动同步</h3>
      <p class="text-sm text-slate-500">设置每日自动同步的开关和执行时间。</p>
    </template>

    <div class="space-y-4">
      <div class="app-shell-muted rounded-[26px] p-4 sm:p-5">
        <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div class="min-w-0">
            <UCheckbox v-model="preferences.dailySyncEnabled" name="dailySyncEnabled" label="启用每日自动同步全部订阅源" />
            <p class="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
              开启后，系统会按设定时间自动执行一次全部订阅源同步，无需保持页面打开。
            </p>
          </div>

          <div class="w-full md:w-[180px]">
            <p class="mb-1 text-sm font-medium">执行时间（北京时间）</p>
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

      <div class="flex justify-end">
        <UButton color="black" icon="i-lucide:save" :loading="savingPreferences" @click="saveSchedulerSettings">
          保存
        </UButton>
      </div>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import useSavePreferences from '~/composables/useSavePreferences';
import type { Preferences } from '~/types/preferences';

const preferences: Ref<Preferences> = usePreferences() as unknown as Ref<Preferences>;
const { saveNow, saving: savingPreferences } = useSavePreferences();

const cardUi = {
  ring: '',
  divide: 'divide-y divide-slate-200/70 dark:divide-slate-800/80',
  header: { padding: 'px-5 pb-0 pt-5 sm:px-6 sm:pt-6' },
  body: { padding: 'px-5 pb-5 pt-5 sm:px-6 sm:pb-6 sm:pt-5' },
};

function normalizeDailySyncTime() {
  const raw = String(preferences.value.dailySyncTime || '').trim();
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(raw);
  preferences.value.dailySyncTime = match ? `${match[1]}:${match[2]}` : '03:00';
}

async function saveSchedulerSettings() {
  normalizeDailySyncTime();
  await saveNow();
}
</script>
