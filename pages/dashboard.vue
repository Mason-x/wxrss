<template>
  <div class="h-screen">
    <template v-if="standaloneMode">
      <NuxtPage />
    </template>
    <template v-else>
      <div class="app-shell-bg h-screen">
        <div class="flex h-full flex-col px-3 pb-3 pt-3 text-slate-900 dark:text-slate-100 md:hidden">
          <header
            class="app-shell-glass flex h-[56px] flex-shrink-0 items-center justify-between rounded-[24px] px-4"
          >
            <div class="min-w-0">
              <p class="truncate text-base font-semibold">{{ mobileCurrentTitle }}</p>
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
                  class="app-shell-panel mobile-top-menu fixed inset-x-3 top-[72px] max-h-[calc(100vh-88px)] overflow-hidden rounded-[30px]"
                >
                  <div class="flex items-start justify-between gap-4 border-b border-slate-200/70 px-5 pb-4 pt-5 dark:border-slate-800/80">
                    <div class="min-w-0">
                      <p class="text-base font-semibold">系统菜单</p>
                      <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">页面切换和全局工具统一放在顶部，不再占用底部空间。</p>
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

                  <div class="app-shell-scrollbar max-h-[calc(100vh-180px)] overflow-y-auto px-5 py-4">
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
                        <h3 class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">全局工具</h3>
                        <div class="app-shell-muted rounded-[24px] px-4 py-4">
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
            <div class="app-shell-glass flex h-[64px] flex-shrink-0 items-center justify-between border-b border-slate-200/60 px-6 dark:border-slate-800/70">
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
const mobileMenuOpen = ref(false);
const readerMode = computed(() => route.path.startsWith('/dashboard/reader'));
const embeddedMode = computed(() => {
  const value = route.query.embed;
  if (Array.isArray(value)) {
    return value.includes('1');
  }
  return value === '1';
});
const standaloneMode = computed(() => readerMode.value || embeddedMode.value);

const mobileNavItems: MobileNavItem[] = [
  { name: '阅读', icon: 'i-lucide:newspaper', href: '/dashboard/reader' },
  { name: '账号', icon: 'i-lucide:users', href: '/dashboard/account' },
  { name: '单篇', icon: 'i-lucide:file-text', href: '/dashboard/single' },
  { name: '文章', icon: 'i-lucide:table-properties', href: '/dashboard/article' },
  { name: '私有代理', icon: 'i-lucide:network', href: '/dashboard/proxy' },
  { name: 'API', icon: 'i-lucide:file-code-2', href: '/dashboard/api' },
  { name: '设置', icon: 'i-lucide:settings-2', href: '/dashboard/settings' },
];

const mobileCurrentTitle = computed(() => {
  const item = mobileNavItems.find(item => route.path === item.href);
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
  @apply !inline-flex size-8 !gap-0 !p-0 items-center justify-center rounded-full border border-slate-200
    bg-white/80 text-slate-600 transition-all duration-200 hover:-translate-y-px hover:bg-white hover:text-slate-900
    dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white;
}

.mobile-menu-link {
  @apply flex items-center justify-between gap-3 rounded-[22px] border border-white/80 bg-white/70 px-4 py-3 text-sm text-slate-700 transition-all duration-200
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
