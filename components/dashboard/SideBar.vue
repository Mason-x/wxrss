<script setup lang="ts">
import BottomPanel from '~/components/dashboard/BottomPanel.vue';
import NavMenus from '~/components/dashboard/NavMenus.vue';
import { websiteName } from '~/config';
</script>

<template>
  <aside
    class="app-shell-panel hidden h-full w-[268px] flex-shrink-0 flex-col justify-between overflow-hidden rounded-[32px] px-4 pb-5 pt-4 md:flex"
  >
    <div class="space-y-4">
      <div class="app-shell-muted flex h-[68px] items-center rounded-[24px] px-4">
        <NuxtLink to="/" class="flex items-center gap-3">
          <span
            class="inline-flex size-10 items-center justify-center rounded-2xl bg-white text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-600 shadow-[0_10px_24px_rgba(15,23,42,0.08)] dark:bg-slate-900 dark:text-slate-300"
          >
            WX
          </span>
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Workspace</p>
            <p class="text-lg font-semibold">{{ websiteName }}</p>
          </div>
        </NuxtLink>
      </div>

      <NavMenus />
    </div>

    <BottomPanel />
  </aside>
</template>
