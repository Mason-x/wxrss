<template>
  <div class="h-screen">
    <template v-if="standaloneMode">
      <NuxtPage />
    </template>
    <template v-else>
      <div class="h-screen">
        <div class="flex h-full flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 md:hidden">
          <header
            class="flex h-[56px] flex-shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50/92 px-4 shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/92"
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
              @click="mobileMenuOpen = true"
            />
          </header>

          <div class="min-h-0 flex-1 overflow-hidden">
            <NuxtPage />
          </div>

          <nav
            class="border-t border-slate-200 bg-white/92 px-3 pb-[calc(env(safe-area-inset-bottom)+0.85rem)] pt-2 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/92"
          >
            <div class="grid grid-cols-4 gap-2">
              <NuxtLink
                v-for="item in mobilePrimaryNavItems"
                :key="item.href"
                :to="item.href"
                class="mobile-nav-link"
                :class="{ 'is-active': isMobileNavActive(item.href) }"
              >
                <UIcon :name="item.icon" class="size-4 shrink-0" />
                <span>{{ item.name }}</span>
              </NuxtLink>

              <button type="button" class="mobile-nav-link" @click="mobileMenuOpen = true">
                <UIcon name="i-lucide:ellipsis" class="size-4 shrink-0" />
                <span>更多</span>
              </button>
            </div>
          </nav>

          <Transition name="mobile-sheet-fade">
            <div
              v-if="mobileMenuOpen"
              class="fixed inset-0 z-50 flex items-end bg-slate-950/35 px-3 pb-[calc(env(safe-area-inset-bottom)+0.85rem)] pt-6 backdrop-blur-[3px]"
              @click.self="mobileMenuOpen = false"
            >
              <Transition name="mobile-sheet-up">
                <section
                  v-if="mobileMenuOpen"
                  class="mobile-sheet-panel w-full overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950"
                >
                  <div class="flex justify-center pt-3">
                    <div class="h-1.5 w-12 rounded-full bg-slate-200 dark:bg-slate-700" />
                  </div>

                  <div class="flex items-start justify-between px-5 pb-4 pt-4">
                    <div>
                      <p class="text-base font-semibold text-slate-900 dark:text-slate-100">更多功能</p>
                      <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">切换页面、打开全局工具和常用设置。</p>
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

                  <div class="max-h-[75vh] overflow-y-auto px-5 pb-5">
                    <div class="space-y-5">
                      <section class="space-y-3">
                        <div class="flex items-center justify-between">
                          <h3 class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">页面</h3>
                          <span class="text-xs text-slate-400">{{ mobileCurrentTitle }}</span>
                        </div>

                        <div class="grid grid-cols-2 gap-2.5">
                          <NuxtLink
                            v-for="item in mobileAllNavItems"
                            :key="item.href"
                            :to="item.href"
                            class="mobile-menu-link"
                            :class="{ 'is-active': isMobileNavActive(item.href) }"
                            @click="mobileMenuOpen = false"
                          >
                            <UIcon :name="item.icon" class="size-4 shrink-0" />
                            <span class="truncate">{{ item.name }}</span>
                          </NuxtLink>
                        </div>
                      </section>

                      <section class="space-y-3 border-t border-slate-200 pt-5 dark:border-slate-800">
                        <h3 class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">全局工具</h3>
                        <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
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

        <div class="hidden h-screen md:flex">
          <SideBar />

          <div class="flex h-screen flex-1 flex-col overflow-hidden">
            <div class="flex h-[60px] flex-shrink-0 items-center justify-between border-b border-slate-6 px-6 dark:border-slate-600">
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

const mobilePrimaryNavItems: MobileNavItem[] = [
  { name: '阅读', icon: 'i-lucide:newspaper', href: '/dashboard/reader' },
  { name: '账号', icon: 'i-lucide:users', href: '/dashboard/account' },
  { name: '单篇', icon: 'i-lucide:file-text', href: '/dashboard/single' },
];

const mobileAllNavItems: MobileNavItem[] = [
  ...mobilePrimaryNavItems,
  { name: '文章', icon: 'i-lucide:table-properties', href: '/dashboard/article' },
  { name: '代理', icon: 'i-lucide:network', href: '/dashboard/proxy' },
  { name: 'API', icon: 'i-lucide:file-code-2', href: '/dashboard/api' },
  { name: '设置', icon: 'i-lucide:settings-2', href: '/dashboard/settings' },
];

const mobileCurrentTitle = computed(() => {
  const item = mobileAllNavItems.find(item => route.path === item.href);
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
    bg-white/80 text-slate-600 transition-colors hover:bg-white hover:text-slate-900
    dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white;
}

.mobile-nav-link {
  @apply inline-flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl border border-transparent px-2 py-2.5 text-[11px]
    text-slate-500 transition-all duration-200 dark:text-slate-400;
}

.mobile-nav-link.is-active {
  @apply border-slate-200 bg-slate-100 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100;
}

.mobile-sheet-panel {
  box-shadow: 0 -24px 80px rgba(15, 23, 42, 0.22);
}

.mobile-menu-link {
  @apply inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 transition-all duration-200
    hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800;
}

.mobile-menu-link.is-active {
  @apply border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900;
}

.mobile-sheet-fade-enter-active,
.mobile-sheet-fade-leave-active {
  transition: opacity 180ms ease;
}

.mobile-sheet-fade-enter-from,
.mobile-sheet-fade-leave-to {
  opacity: 0;
}

.mobile-sheet-up-enter-active,
.mobile-sheet-up-leave-active {
  transition: transform 220ms ease, opacity 220ms ease;
}

.mobile-sheet-up-enter-from,
.mobile-sheet-up-leave-to {
  opacity: 0;
  transform: translateY(24px);
}
</style>
