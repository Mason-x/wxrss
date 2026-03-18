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
              icon="i-lucide:menu"
              class="mobile-shell-btn"
              @click="mobileMenuOpen = !mobileMenuOpen"
            />
          </header>

          <div class="min-h-0 flex-1 overflow-hidden pt-3">
            <NuxtPage />
          </div>

          <Transition name="mobile-menu-fade">
            <div
              v-if="mobileMenuOpen"
              class="fixed inset-0 z-50 bg-slate-950/30 backdrop-blur-[12px]"
              @click.self="mobileMenuOpen = false"
            >
              <Transition name="mobile-menu-drop">
                <section
                  v-if="mobileMenuOpen"
                  class="app-shell-panel mobile-top-menu fixed inset-x-3 overflow-hidden rounded-[30px]"
                  :style="mobileMenuStyle"
                >
                  <div
                    class="flex items-start justify-between gap-4 border-b border-slate-200/70 px-5 pb-4 pt-5 dark:border-slate-800/80"
                  >
                    <div class="min-w-0">
                      <p class="text-lg font-semibold">系统菜单</p>
                      <p class="mt-1 max-w-[18rem] text-xs leading-5 text-slate-500 dark:text-slate-400">
                        页面切换和全局工具都收在顶部菜单里，减少底部遮挡和无效留白。
                      </p>
                    </div>
                    <UButton
                      size="2xs"
                      color="gray"
                      variant="ghost"
                      icon="i-lucide:x"
                      class="mobile-shell-btn"
                      @click="mobileMenuOpen = false"
                    />
                  </div>

                  <div class="app-shell-scrollbar overflow-y-auto px-5 py-4" :style="mobileMenuBodyStyle">
                    <div class="space-y-5">
                      <section class="space-y-3">
                        <div class="flex items-center justify-between">
                          <h3 class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">页面</h3>
                          <span class="text-xs text-slate-400">{{ mobileCurrentTitle }}</span>
                        </div>

                        <div class="space-y-2">
                          <NuxtLink
                            v-for="item in mobileNavItems"
                            :key="item.href"
                            :to="item.href"
                            class="mobile-menu-link"
                            :class="{ 'is-active': isMobileNavActive(item.href) }"
                            @click="mobileMenuOpen = false"
                          >
                            <div class="flex min-w-0 items-center gap-3">
                              <UIcon :name="item.icon" class="size-4 shrink-0" />
                              <span class="truncate">{{ item.name }}</span>
                            </div>
                            <UIcon name="i-lucide:chevron-right" class="size-4 shrink-0 text-slate-400" />
                          </NuxtLink>
                        </div>
                      </section>

                      <section class="space-y-3 border-t border-slate-200/70 pt-5 dark:border-slate-800/80">
                        <div class="flex items-center justify-between">
                          <h3 class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">全局工具</h3>
                          <span class="text-xs text-slate-400">凭据与文档</span>
                        </div>
                        <div class="app-shell-muted rounded-[22px] px-3 py-3">
                          <GlobalActions mobile />
                        </div>
                      </section>
                    </div>
                  </div>
                </section>
              </Transition>
            </div>
          </Transition>
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

interface MobileNavItem {
  name: string;
  icon: string;
  href: string;
}

const route = useRoute();
const loginAccount = useLoginAccount();
const mobileMenuOpen = ref(false);
const readerMode = computed(() => route.path.startsWith('/dashboard/reader'));
const mobileShellStyle = computed(() => ({
  paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
  paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
}));
const mobileMenuStyle = computed(() => ({
  top: 'calc(env(safe-area-inset-top) + 5rem)',
  maxHeight: 'calc(100vh - env(safe-area-inset-top) - 5.75rem)',
}));
const mobileMenuBodyStyle = computed(() => ({
  maxHeight: 'calc(100vh - env(safe-area-inset-top) - 11rem)',
}));
const embeddedMode = computed(() => {
  const value = route.query.embed;
  if (Array.isArray(value)) {
    return value.includes('1');
  }
  return value === '1';
});
const standaloneMode = computed(() => readerMode.value || embeddedMode.value);

const mobileNavItems = computed<MobileNavItem[]>(() => {
  const isAdmin = loginAccount.value?.role === 'admin';
  const items: MobileNavItem[] = [
    { name: '阅读', icon: 'i-lucide:newspaper', href: '/dashboard/reader' },
    { name: '单篇', icon: 'i-lucide:file-text', href: '/dashboard/single' },
    { name: '文章', icon: 'i-lucide:table-properties', href: '/dashboard/article' },
    { name: '设置', icon: 'i-lucide:settings-2', href: '/dashboard/settings' },
  ];

  if (isAdmin) {
    items.push({ name: '用户管理', icon: 'i-lucide:shield-check', href: '/dashboard/users' });
  }

  return items;
});

const mobileCurrentTitle = computed(() => {
  const item = mobileNavItems.value.find(entry => route.path === entry.href);
  if (item) {
    return item.name;
  }
  if (route.path.startsWith('/dashboard/album')) return '合集';
  return '控制台';
});

watch(
  () => route.fullPath,
  () => {
    mobileMenuOpen.value = false;
  }
);

function isMobileNavActive(href: string) {
  return route.path === href;
}
</script>

<style scoped>
.mobile-shell-btn {
  @apply !inline-flex size-10 !gap-0 !p-0 items-center justify-center rounded-full border border-slate-200
    bg-white/80 text-slate-600 transition-all duration-200 hover:-translate-y-px hover:bg-white hover:text-slate-900
    dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white;
}

.mobile-menu-link {
  @apply flex items-center justify-between gap-3 rounded-[22px] border border-white/80 bg-white/70 px-4 py-3.5 text-sm text-slate-700 transition-all duration-200
    hover:-translate-y-px hover:bg-white hover:shadow-[0_16px_30px_rgba(15,23,42,0.08)]
    dark:border-white/10 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:bg-slate-900;
}

.mobile-menu-link.is-active {
  @apply border-white bg-white text-slate-900 shadow-[0_18px_34px_rgba(15,23,42,0.1)]
    dark:border-white/10 dark:bg-slate-900 dark:text-slate-100;
}

.mobile-menu-fade-enter-active,
.mobile-menu-fade-leave-active {
  transition: opacity 180ms ease;
}

.mobile-menu-fade-enter-from,
.mobile-menu-fade-leave-to {
  opacity: 0;
}

.mobile-menu-drop-enter-active,
.mobile-menu-drop-leave-active {
  transition: transform 220ms ease, opacity 220ms ease;
}

.mobile-menu-drop-enter-from,
.mobile-menu-drop-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}
</style>
