<script setup lang="ts">
withDefaults(
  defineProps<{
    count?: number;
  }>(),
  {
    count: 3,
  }
);
</script>

<template>
  <div class="space-y-3">
    <div
      v-for="idx in count"
      :key="idx"
      class="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_14px_34px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-900"
    >
      <div class="h-4 w-2/3 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
      <div class="mt-3 h-3 w-1/2 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
      <div class="mt-4 h-20 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
    </div>
  </div>
</template>
