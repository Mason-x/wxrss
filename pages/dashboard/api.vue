<template>
  <div class="flex h-full flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
    <Teleport defer to="#title">
      <h1 class="text-[28px] leading-[34px] text-slate-12 dark:text-slate-50 font-bold">API</h1>
    </Teleport>

    <div class="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
      <div class="mx-auto max-w-5xl space-y-10 md:space-y-16">
      <ApiSummary />
      <ApiDocument v-for="(api, idx) in apis" :key="idx" v-bind="api" :index="idx + 1" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { websiteName } from '~/config';
import { apis } from '~/config/public-apis';

useHead({
  title: `API | ${websiteName}`,
});
</script>
