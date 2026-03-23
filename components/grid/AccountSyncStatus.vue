<script setup lang="ts">
import type { ICellRendererParams } from 'ag-grid-community';

interface AccountSyncRuntimeState {
  status: 'running' | 'error';
  syncedMessages: number;
  totalMessages: number;
  syncedArticles: number;
  errorMessage: string;
  updatedAt: number;
}

interface AccountRow {
  _runtimeSync?: AccountSyncRuntimeState | null;
}

interface Props {
  params: ICellRendererParams<AccountRow>;
}

const props = defineProps<Props>();
const paramsRef = shallowRef(props.params);

const state = computed<AccountSyncRuntimeState | null>(() => paramsRef.value.data?._runtimeSync || null);
const percent = computed(() => {
  if (!state.value || state.value.status !== 'running' || state.value.totalMessages <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round((state.value.syncedMessages / state.value.totalMessages) * 100)));
});

function refresh(params: ICellRendererParams<AccountRow>): boolean {
  paramsRef.value = params;
  return true;
}

defineExpose({
  refresh,
});
</script>

<template>
  <div v-if="state" class="py-1">
    <div
      v-if="state.status === 'running'"
      class="space-y-1.5 rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2 dark:border-blue-500/20 dark:bg-blue-500/10"
    >
      <div class="flex items-center justify-between gap-2 text-[11px] text-blue-700 dark:text-blue-300">
        <span class="font-medium">同步中</span>
        <span>{{ percent }}%</span>
      </div>
      <div class="h-1.5 rounded-full bg-blue-100 dark:bg-blue-500/20">
        <div class="h-1.5 rounded-full bg-blue-500 transition-all" :style="{ width: `${percent}%` }" />
      </div>
      <p class="truncate text-[11px] text-blue-700 dark:text-blue-300">
        {{ state.syncedMessages }}/{{ state.totalMessages || 0 }}，文章 {{ state.syncedArticles }}
      </p>
    </div>
    <div
      v-else
      class="rounded-xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-[11px] leading-5 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200"
      :title="state.errorMessage"
    >
      <p class="font-medium">同步失败</p>
      <p class="truncate">{{ state.errorMessage }}</p>
    </div>
  </div>
  <div v-else class="text-xs text-slate-400">-</div>
</template>
