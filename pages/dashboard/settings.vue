<template>
  <div class="flex h-full flex-col overflow-hidden text-slate-900 dark:text-slate-100">
    <Teleport defer to="#title">
      <div class="min-w-0">
        <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">Workspace</p>
        <h1 class="mt-1 truncate text-[26px] font-semibold leading-[32px] text-slate-900 dark:text-slate-100">设置</h1>
      </div>
    </Teleport>

    <div class="app-shell-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
      <div class="mx-auto max-w-5xl space-y-5 md:space-y-6">
        <SettingScheduler />
        <SettingProxy />
        <SettingExport />
        <SettingMisc />

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
