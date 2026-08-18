<script setup lang="ts">
import type { ICellRendererParams } from 'ag-grid-community';
import { formatRunningSyncText, getKnownSyncPercent } from '#shared/utils/account-profile';

interface AccountSyncRuntimeState {
  status: 'running' | 'error';
  syncedMessages: number;
  scannedMessages?: number;
  totalMessages: number;
  syncedArticles: number;
  errorMessage: string;
  updatedAt: number;
  source?: 'local' | 'remote';
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
const percent = computed(() =>
  state.value
    ? getKnownSyncPercent({
        syncedMessages: state.value.syncedMessages,
        totalMessages: state.value.totalMessages,
      })
    : 0
);
const detail = computed(() =>
  state.value
    ? formatRunningSyncText({
        syncedMessages: state.value.syncedMessages,
        scannedMessages: Number(state.value.scannedMessages) || 0,
        totalMessages: state.value.totalMessages,
        syncedArticles: state.value.syncedArticles,
      })
    : ''
);

function refresh(params: ICellRendererParams<AccountRow>): boolean {
  paramsRef.value = params;
  return true;
}

defineExpose({
  refresh,
});
</script>

<template>
  <div v-if="state?.status === 'running'" class="flex h-full min-w-0 items-center gap-2 overflow-hidden py-0">
    <span class="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-500/20 dark:text-blue-200">
      同步中
    </span>
    <div class="h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div
        class="h-1.5 rounded-full bg-blue-500 transition-all"
        :class="percent <= 0 ? 'w-1/3 animate-pulse' : ''"
        :style="percent > 0 ? { width: `${percent}%` } : undefined"
      />
    </div>
    <span class="max-w-[9.5rem] shrink-0 truncate text-[11px] text-slate-500" :title="detail">{{ detail }}</span>
  </div>
  <div
    v-else-if="state?.status === 'error'"
    class="flex h-full min-w-0 items-center overflow-hidden text-[11px] text-rose-600 dark:text-rose-300"
    :title="state.errorMessage"
  >
    <span class="truncate">失败：{{ state.errorMessage }}</span>
  </div>
  <div v-else class="flex h-full items-center text-xs text-slate-400">-</div>
</template>
