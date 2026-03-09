<template>
  <div class="flex h-full flex-col overflow-hidden text-slate-900 dark:text-slate-100">
    <div class="min-h-0 flex-1 overflow-hidden md:px-6 md:py-6">
      <div class="grid h-full min-h-0 gap-4 md:grid-cols-[220px_minmax(0,1fr)] md:gap-5">
        <aside class="hidden min-h-0 md:block">
          <div class="settings-anchor-panel sticky top-0">
            <p class="settings-anchor-eyebrow">设置</p>
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
            class="app-shell-scrollbar h-full min-h-0 overflow-y-auto px-0 py-0 md:px-6 md:py-6"
            @scroll.passive="syncActiveSectionFromScroll"
          >
            <div class="mx-auto max-w-5xl space-y-4 md:space-y-6">
              <section
                v-for="section in sections"
                :id="section.id"
                :key="section.id"
                :ref="el => setSectionRef(section.id, el)"
                class="settings-section"
              >
                <component :is="section.component" />
              </section>

              <div class="h-10 md:h-20" />
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
    description: '目录与内容规则',
    icon: 'i-lucide:files',
    component: SettingExport,
  },
  {
    id: 'misc',
    label: '其他选项',
    description: '缓存与同步节奏',
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
  return window.innerWidth >= 768 ? 24 : 0;
}

function scrollToSection(id: SettingsSectionId) {
  const container = scrollContainerRef.value;
  const target = sectionRefs[id];
  if (!container || !target) return;

  activeSection.value = id;
  container.scrollTo({
    top: Math.max(0, target.offsetTop - getScrollOffset()),
    behavior: 'smooth',
  });
}

function syncActiveSectionFromScroll() {
  if (window.innerWidth < 768) {
    return;
  }

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
  min-height: 0;
  overflow: hidden;
  background: transparent;
  border: none;
  box-shadow: none;
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

.settings-section {
  scroll-margin-top: 1rem;
}

@media (min-width: 768px) {
  .settings-content-shell {
    @apply rounded-[30px] border border-slate-200/80 bg-white dark:border-slate-800/80 dark:bg-slate-950;
    box-shadow: 0 18px 42px rgba(15, 23, 42, 0.08);
  }

  .settings-section {
    scroll-margin-top: 1.5rem;
  }
}

:global(html.dark) .settings-anchor-panel {
  background: rgba(15, 23, 42, 0.8);
  box-shadow: inset 0 1px 0 rgba(148, 163, 184, 0.06);
}
</style>
