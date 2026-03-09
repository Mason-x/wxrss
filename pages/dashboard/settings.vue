<template>
  <div class="flex h-full flex-col overflow-hidden text-slate-900 dark:text-slate-100">
    <Teleport defer to="#title">
      <div class="min-w-0">
        <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">Workspace</p>
        <h1 class="mt-1 truncate text-[26px] font-semibold leading-[32px] text-slate-900 dark:text-slate-100">设置</h1>
      </div>
    </Teleport>

    <div class="min-h-0 flex-1 overflow-hidden px-4 py-4 md:px-6 md:py-6">
      <div class="grid h-full min-h-0 gap-4 md:grid-cols-[220px_minmax(0,1fr)] md:gap-5">
        <aside class="hidden min-h-0 md:block">
          <div class="settings-anchor-panel sticky top-0">
            <p class="settings-anchor-eyebrow">Settings</p>
            <nav class="mt-3 space-y-2">
              <button
                v-for="section in sections"
                :key="section.id"
                type="button"
                class="settings-anchor-btn"
                :class="{ 'is-active': activeSection === section.id }"
                @click="scrollToSection(section.id)"
              >
                <div class="flex items-center gap-3">
                  <UIcon :name="section.icon" class="size-4 shrink-0" />
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium">{{ section.label }}</p>
                    <p class="truncate text-xs text-slate-500 dark:text-slate-400">{{ section.description }}</p>
                  </div>
                </div>
              </button>
            </nav>
          </div>
        </aside>

        <div class="settings-content-shell">
          <div
            ref="scrollContainerRef"
            class="app-shell-scrollbar h-full min-h-0 overflow-y-auto px-4 py-4 md:px-6 md:py-6"
            @scroll.passive="syncActiveSectionFromScroll"
          >
            <div class="sticky top-0 z-20 -mx-4 mb-4 border-b border-slate-200/70 bg-[rgba(249,249,247,0.96)] px-4 py-3 backdrop-blur md:hidden dark:border-slate-800/80 dark:bg-[rgba(2,6,23,0.92)]">
              <div class="app-shell-scrollbar flex gap-2 overflow-x-auto pb-1">
                <button
                  v-for="section in sections"
                  :key="`mobile-${section.id}`"
                  type="button"
                  class="settings-mobile-anchor"
                  :class="{ 'is-active': activeSection === section.id }"
                  @click="scrollToSection(section.id)"
                >
                  {{ section.label }}
                </button>
              </div>
            </div>

            <div class="mx-auto max-w-5xl space-y-5 md:space-y-6">
              <section
                v-for="section in sections"
                :id="section.id"
                :key="section.id"
                :ref="el => setSectionRef(section.id, el)"
                class="settings-section"
              >
                <component :is="section.component" />
              </section>

              <div class="h-16 md:h-24" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, type Component, type ComponentPublicInstance } from 'vue';
import SettingExport from '~/components/setting/Export.vue';
import SettingMisc from '~/components/setting/Misc.vue';
import SettingProxy from '~/components/setting/Proxy.vue';
import SettingScheduler from '~/components/setting/Scheduler.vue';
import { websiteName } from '~/config';

useHead({
  title: `设置 | ${websiteName}`,
});

type SettingsSectionId = 'scheduler' | 'proxy' | 'export' | 'misc';

interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  description: string;
  icon: string;
  component: Component;
}

const sections: SettingsSection[] = [
  {
    id: 'scheduler',
    label: '每日自动同步',
    description: '任务与执行时间',
    icon: 'i-lucide:calendar-clock',
    component: SettingScheduler,
  },
  {
    id: 'proxy',
    label: '代理节点',
    description: '抓取与下载代理',
    icon: 'i-lucide:network',
    component: SettingProxy,
  },
  {
    id: 'export',
    label: '导出选项',
    description: '目录与内容策略',
    icon: 'i-lucide:files',
    component: SettingExport,
  },
  {
    id: 'misc',
    label: '其他选项',
    description: '缓存与同步规则',
    icon: 'i-lucide:sliders-horizontal',
    component: SettingMisc,
  },
];

const activeSection = ref<SettingsSectionId>('scheduler');
const scrollContainerRef = ref<HTMLElement | null>(null);
const sectionRefs = reactive<Record<SettingsSectionId, HTMLElement | null>>({
  scheduler: null,
  proxy: null,
  export: null,
  misc: null,
});

function setSectionRef(id: SettingsSectionId, el: Element | ComponentPublicInstance | null) {
  sectionRefs[id] = el instanceof HTMLElement ? el : null;
}

function getScrollOffset() {
  return window.innerWidth >= 768 ? 24 : 84;
}

function scrollToSection(id: SettingsSectionId) {
  const container = scrollContainerRef.value;
  const target = sectionRefs[id];
  if (!container || !target) return;

  activeSection.value = id;
  const top = Math.max(0, target.offsetTop - getScrollOffset());
  container.scrollTo({
    top,
    behavior: 'smooth',
  });
}

function syncActiveSectionFromScroll() {
  const container = scrollContainerRef.value;
  if (!container) return;

  const threshold = container.scrollTop + getScrollOffset() + 12;
  let nextActive = sections[0].id;

  for (const section of sections) {
    const target = sectionRefs[section.id];
    if (target && target.offsetTop <= threshold) {
      nextActive = section.id;
    }
  }

  activeSection.value = nextActive;
}

onMounted(async () => {
  await nextTick();
  syncActiveSectionFromScroll();
});
</script>

<style scoped>
.settings-anchor-panel {
  @apply rounded-[28px] border border-slate-200/80 p-3 dark:border-slate-800/80;
  background: rgba(244, 244, 242, 0.96);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.78);
}

.settings-content-shell {
  @apply min-h-0 overflow-hidden rounded-[30px] border border-slate-200/80 bg-white dark:border-slate-800/80 dark:bg-slate-950;
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.08);
}

.settings-anchor-eyebrow {
  @apply px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500;
}

.settings-anchor-btn {
  @apply w-full rounded-[22px] px-3 py-3 text-left text-slate-700 transition-all duration-200
    hover:bg-white/90 dark:text-slate-200 dark:hover:bg-slate-950/80;
}

.settings-anchor-btn.is-active {
  @apply bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100;
  box-shadow: inset 0 0 0 1px rgba(226, 232, 240, 0.92), 0 10px 22px rgba(15, 23, 42, 0.06);
}

.settings-anchor-btn.is-active :deep(p:last-child) {
  @apply text-slate-500 dark:text-slate-400;
}

.settings-mobile-anchor {
  @apply inline-flex shrink-0 items-center rounded-full border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-600 transition-all duration-200
    dark:border-slate-800/80 dark:bg-slate-950 dark:text-slate-300;
}

.settings-mobile-anchor.is-active {
  @apply border-slate-300 bg-slate-900 text-white shadow-[0_14px_28px_rgba(15,23,42,0.12)]
    dark:border-slate-700 dark:bg-slate-100 dark:text-slate-900;
}

.settings-section {
  scroll-margin-top: 1.5rem;
}

@media (max-width: 767px) {
  .settings-content-shell {
    border-radius: 26px;
  }

  .settings-section {
    scroll-margin-top: 5.75rem;
  }
}

:global(html.dark) .settings-anchor-panel {
  background: rgba(15, 23, 42, 0.8);
  box-shadow: inset 0 1px 0 rgba(148, 163, 184, 0.06);
}
</style>
