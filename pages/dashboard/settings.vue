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
            class="app-shell-scrollbar h-full min-h-0 overflow-y-auto overscroll-contain px-0 py-0 md:px-6 md:py-6"
            @scroll.passive="syncActiveSectionFromScroll"
          >
            <div class="mx-auto max-w-5xl space-y-4 md:space-y-6">
              <div
                v-if="!isAdmin"
                class="rounded-[28px] border border-sky-200/80 bg-white/85 px-5 py-4 text-sm text-sky-700 shadow-[0_12px_24px_rgba(14,165,233,0.08)] dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200"
              >
                普通用户仅可调整个人同步与 AI 标签项。其余设置由管理员统一维护，并对所有用户生效。
              </div>

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
import { type Component, type ComponentPublicInstance, nextTick } from 'vue';
import SettingAiSummary from '~/components/setting/AiSummary.vue';
import SettingExport from '~/components/setting/Export.vue';
import SettingMisc from '~/components/setting/Misc.vue';
import SettingProxy from '~/components/setting/Proxy.vue';
import SettingScheduler from '~/components/setting/Scheduler.vue';
import { websiteName } from '~/config';

useHead({
  title: `设置 | ${websiteName}`,
});

type SettingsSectionId = 'scheduler' | 'ai' | 'proxy' | 'export' | 'misc';

interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  description: string;
  icon: string;
  component: Component;
}

const preferenceAccess = usePreferencesAccess();
const isAdmin = computed(() => preferenceAccess.value.role === 'admin');

const sections = computed<SettingsSection[]>(() => {
  const items: SettingsSection[] = [
    {
      id: 'scheduler',
      label: '每日自动同步',
      description: '个人同步开关与执行时间',
      icon: 'i-lucide:calendar-clock',
      component: SettingScheduler,
    },
    {
      id: 'ai',
      label: 'AI 功能',
      description: '自定义标签、日报筛选与摘要开关',
      icon: 'i-lucide:sparkles',
      component: SettingAiSummary,
    },
    {
      id: 'misc',
      label: '其他选项',
      description: isAdmin.value ? '全局行为与个人同步范围' : '个人同步时间范围',
      icon: 'i-lucide:sliders-horizontal',
      component: SettingMisc,
    },
  ];

  if (isAdmin.value) {
    items.splice(2, 0, {
      id: 'proxy',
      label: '私有代理',
      description: '抓取与下载代理节点',
      icon: 'i-lucide:network',
      component: SettingProxy,
    });
    items.splice(3, 0, {
      id: 'export',
      label: '导出选项',
      description: '目录规则与内容导出范围',
      icon: 'i-lucide:files',
      component: SettingExport,
    });
  }

  return items;
});

const activeSection = ref<SettingsSectionId>('scheduler');
const scrollContainerRef = ref<HTMLElement | null>(null);
const sectionRefs = reactive<Record<SettingsSectionId, HTMLElement | null>>({
  scheduler: null,
  ai: null,
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
  if (!container || !target) {
    return;
  }

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
  if (!container) {
    return;
  }

  const availableSections = sections.value;
  const threshold = container.scrollTop + getScrollOffset() + 12;
  let nextActive = availableSections[0]?.id || 'scheduler';

  for (const section of availableSections) {
    const target = sectionRefs[section.id];
    if (target && target.offsetTop <= threshold) {
      nextActive = section.id;
    }
  }

  activeSection.value = nextActive;
}

watch(
  sections,
  value => {
    if (!value.some(section => section.id === activeSection.value)) {
      activeSection.value = value[0]?.id || 'scheduler';
    }
  },
  { immediate: true }
);

onMounted(async () => {
  await nextTick();
  syncActiveSectionFromScroll();
});
</script>

<style scoped>
.settings-anchor-panel {
  @apply rounded-[28px] border border-slate-200/80 p-3 dark:border-slate-800/80;
  background: var(--app-surface-strong);
  box-shadow: inset 0 1px 0 var(--app-border-strong), var(--app-shadow-soft);
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
    @apply rounded-[30px] border border-slate-200/80 dark:border-slate-800/80;
    background: var(--app-surface-strong);
    box-shadow: var(--app-shadow-soft);
  }

  .settings-section {
    scroll-margin-top: 1.5rem;
  }
}

@media (max-width: 767px) {
  .settings-content-shell :deep(input),
  .settings-content-shell :deep(textarea),
  .settings-content-shell :deep(select) {
    font-size: 16px !important;
  }
}

:global(html.dark) .settings-anchor-panel {
  background: var(--app-surface-strong);
  box-shadow: inset 0 1px 0 var(--app-border-strong), var(--app-shadow-soft);
}
</style>
