<template>
  <div class="h-screen">
    <template v-if="standaloneMode">
      <NuxtPage />
    </template>
    <template v-else>
      <div class="app-shell-bg h-screen">
        <div class="flex h-full flex-col px-3 text-slate-900 dark:text-slate-100 md:hidden" :style="mobileShellStyle">
          <header
            class="app-shell-glass flex min-h-[60px] flex-shrink-0 items-center justify-between rounded-[26px] px-4"
          >
            <div class="min-w-0">
              <p class="truncate text-lg font-semibold leading-6">{{ mobileCurrentTitle }}</p>
              <div id="title" class="hidden"></div>
            </div>
            <UButton
              size="2xs"
              color="gray"
              variant="ghost"
              icon="i-lucide:x"
              class="mobile-shell-btn"
              @click="closeMobileDashboard"
            />
          </header>

          <div class="min-h-0 flex-1 overflow-hidden pt-3">
            <NuxtPage />
          </div>
        </div>

        <div class="hidden h-screen gap-3 p-3 md:flex">
          <SideBar />

          <div class="app-shell-panel flex h-full flex-1 flex-col overflow-hidden rounded-[32px]">
            <div
              class="app-shell-glass flex h-[64px] flex-shrink-0 items-center justify-between border-b border-slate-200/60 px-6 dark:border-slate-800/70"
            >
              <div id="title"></div>
              <GlobalActions />
            </div>

            <div class="flex-1 overflow-hidden">
              <NuxtPage />
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import GlobalActions from '~/components/dashboard/Actions.vue';
import SideBar from '~/components/dashboard/SideBar.vue';

const route = useRoute();
const readerMode = computed(() => route.path.startsWith('/dashboard/reader'));
const mobileShellStyle = computed(() => ({
  paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
  paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
}));
const embeddedMode = computed(() => {
  const value = route.query.embed;
  if (Array.isArray(value)) {
    return value.includes('1');
  }
  return value === '1';
});
const standaloneMode = computed(() => readerMode.value || embeddedMode.value);

const mobileCurrentTitle = computed(() => {
  if (route.path === '/dashboard/reader') return '阅读';
  if (route.path === '/dashboard/account') return '公众号管理';
  if (route.path === '/dashboard/single') return '单篇';
  if (route.path === '/dashboard/article') return '文章';
  if (route.path === '/dashboard/settings') return '设置';
  if (route.path === '/dashboard/users') return '用户管理';
  if (route.path.startsWith('/dashboard/album')) return '合集';
  return '控制台';
});

function closeMobileDashboard() {
  void navigateTo('/dashboard/reader');
}
</script>

<style scoped>
.mobile-shell-btn {
  @apply !inline-flex size-10 !gap-0 !p-0 items-center justify-center rounded-full border border-slate-200
    bg-white/80 text-slate-600 transition-all duration-200 hover:-translate-y-px hover:bg-white hover:text-slate-900
    dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white;
}
</style>
