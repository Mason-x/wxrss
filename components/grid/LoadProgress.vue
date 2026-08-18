<script setup lang="ts">
import type { ICellRendererParams } from 'ag-grid-community';
import { getKnownSyncPercent } from '#shared/utils/account-profile';

interface Props {
  params: ICellRendererParams;
}
const props = defineProps<Props>();

const count = ref(Number(props.params.data?.count) || 0);
const total = ref(Number(props.params.data?.total_count) || 0);
const completed = ref(Boolean(props.params.data?.completed));

const percent = computed(() =>
  getKnownSyncPercent({
    syncedMessages: count.value,
    totalMessages: total.value,
    completed: completed.value,
  })
);

function refresh(params: ICellRendererParams): boolean {
  count.value = Number(params.data?.count) || 0;
  total.value = Number(params.data?.total_count) || 0;
  completed.value = Boolean(params.data?.completed);
  return true;
}

defineExpose({
  refresh,
});
</script>

<template>
  <div class="flex h-full min-w-0 items-center gap-2 overflow-hidden">
    <div class="h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div
        class="h-1.5 rounded-full bg-sky-500 transition-all"
        :class="percent <= 0 && count > 0 && !completed ? 'w-1/3 animate-pulse' : ''"
        :style="percent > 0 ? { width: `${percent}%` } : undefined"
      />
    </div>
    <span class="w-10 shrink-0 text-right text-[11px] text-slate-500">
      {{ percent > 0 ? `${percent}%` : count > 0 ? '进行中' : '0%' }}
    </span>
  </div>
</template>
