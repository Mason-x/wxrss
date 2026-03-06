<template>
  <UCard class="mx-4 mt-6">
    <template #header>
      <h3 class="text-2xl font-semibold">每日自动同步</h3>
      <p class="text-sm text-slate-500">后端定时任务，服务在线即可执行</p>
    </template>

    <div class="flex flex-wrap items-end gap-4">
      <UCheckbox
        v-model="preferences.dailySyncEnabled"
        name="dailySyncEnabled"
        label="启用每日自动同步全部公众号"
      />

      <div class="w-[180px]">
        <p class="text-sm mb-1">执行时间</p>
        <UInput
          v-model="preferences.dailySyncTime"
          type="time"
          class="font-mono"
          :disabled="!preferences.dailySyncEnabled"
          @blur="normalizeDailySyncTime"
        />
      </div>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import type { Preferences } from '~/types/preferences';

const preferences: Ref<Preferences> = usePreferences() as unknown as Ref<Preferences>;

function normalizeDailySyncTime() {
  const raw = String(preferences.value.dailySyncTime || '').trim();
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(raw);
  preferences.value.dailySyncTime = match ? `${match[1]}:${match[2]}` : '06:00';
}
</script>
