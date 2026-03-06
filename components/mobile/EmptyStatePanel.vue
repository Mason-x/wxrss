<script setup lang="ts">
withDefaults(
  defineProps<{
    icon: string;
    title: string;
    description: string;
  }>(),
  {}
);
</script>

<template>
  <div class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
    <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
      <UIcon :name="icon" class="text-2xl" />
    </div>
    <div class="space-y-1">
      <p class="text-sm font-semibold text-slate-700 dark:text-slate-200">{{ title }}</p>
      <p class="text-xs leading-5 text-slate-500 dark:text-slate-400">{{ description }}</p>
    </div>
  </div>
</template>
