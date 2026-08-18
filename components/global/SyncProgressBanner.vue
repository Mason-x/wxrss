<script setup lang="ts">
import { formatTimeStamp } from '#shared/utils/helpers';

const route = useRoute();
const { banner, isSyncing, cancelSync, dismissBanner } = usePersistentAccountSyncState();

const visible = computed(() => {
  const path = String(route.path || '');
  return Boolean(banner.value) && path.startsWith('/dashboard') && path !== '/dashboard/account';
});

function goToAccounts() {
  if (route.path !== '/dashboard/account') {
    void navigateTo('/dashboard/account');
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible && banner"
      class="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-[80] flex justify-center px-3"
    >
      <div
        class="pointer-events-auto w-full max-w-xl rounded-[24px] border px-4 py-3 shadow-[0_18px_40px_rgba(15,23,42,0.16)] backdrop-blur"
        :class="
          banner.tone === 'blue'
            ? 'border-blue-200 bg-blue-50/95 text-blue-900 dark:border-blue-500/25 dark:bg-slate-900/95 dark:text-blue-100'
            : banner.tone === 'green'
              ? 'border-emerald-200 bg-emerald-50/95 text-emerald-900 dark:border-emerald-500/25 dark:bg-slate-900/95 dark:text-emerald-100'
              : banner.tone === 'amber'
                ? 'border-amber-200 bg-amber-50/95 text-amber-900 dark:border-amber-500/25 dark:bg-slate-900/95 dark:text-amber-100'
                : 'border-rose-200 bg-rose-50/95 text-rose-900 dark:border-rose-500/25 dark:bg-slate-900/95 dark:text-rose-100'
        "
      >
        <div class="flex items-start gap-3">
          <button class="min-w-0 flex-1 text-left" type="button" @click="goToAccounts">
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                :class="
                  banner.tone === 'blue'
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200'
                    : banner.tone === 'green'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200'
                      : banner.tone === 'amber'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200'
                        : 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200'
                "
              >
                {{ banner.title }}
              </span>
              <span v-if="banner.modeLabel" class="text-[11px] opacity-70">{{ banner.modeLabel }}</span>
              <span v-if="banner.currentAccountName" class="truncate text-sm font-semibold">
                {{ banner.currentAccountName }}
              </span>
            </div>
            <p class="mt-1 text-sm leading-6 opacity-90">{{ banner.detail }}</p>
            <div class="mt-1 text-[11px] opacity-70">
              更新于 {{ formatTimeStamp(Math.floor(banner.updatedAt / 1000)) }}
            </div>
            <div class="mt-2">
              <div class="mb-1 flex items-center justify-between text-[11px] font-medium opacity-80">
                <span>{{ isSyncing ? '同步进度' : '最近一次同步' }}</span>
                <span>{{ banner.progressPercent }}%</span>
              </div>
              <div class="h-2 overflow-hidden rounded-full bg-white/60 dark:bg-white/10">
                <div
                  class="h-2 rounded-full transition-all"
                  :class="
                    isSyncing && banner.progressPercent <= 0
                      ? 'w-1/3 animate-pulse bg-blue-500'
                      : banner.tone === 'green'
                        ? 'bg-emerald-500'
                        : banner.tone === 'amber'
                          ? 'bg-amber-500'
                          : banner.tone === 'rose'
                            ? 'bg-rose-500'
                            : 'bg-blue-500'
                  "
                  :style="isSyncing && banner.progressPercent <= 0 ? undefined : { width: `${banner.progressPercent}%` }"
                />
              </div>
            </div>
          </button>

          <div class="flex shrink-0 flex-col gap-2">
            <UButton v-if="isSyncing" size="xs" color="gray" variant="soft" @click="cancelSync">停止</UButton>
            <UButton
              v-else
              size="xs"
              color="gray"
              variant="ghost"
              @click="dismissBanner"
            >
              关闭
            </UButton>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
