<template>
  <div class="flex h-full flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
    <Teleport defer to="#title">
      <h1 class="text-[28px] font-bold leading-[34px] text-slate-12 dark:text-slate-50">设置</h1>
    </Teleport>

    <div class="min-h-0 flex-1 overflow-y-auto py-4 md:py-6">
      <div class="mx-auto max-w-6xl space-y-6">
        <SettingScheduler />
        <SettingProxy />
        <div class="grid gap-6 lg:grid-cols-2">
          <SettingExport />
          <SettingMisc />
        </div>
        <div class="h-16 md:h-24" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { websiteName } from '~/config';

useHead({
  title: `设置 | ${websiteName}`,
});
</script>
