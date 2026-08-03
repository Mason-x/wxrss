<script setup lang="ts">
import QQGroupModal from '~/components/modal/QQGroup.vue';
import { docsWebSite } from '~/config';
import { gotoLink } from '~/utils';

const modal = useModal();

const props = withDefaults(
  defineProps<{
    mobile?: boolean;
  }>(),
  {
    mobile: false,
  }
);
</script>

<template>
  <ul :class="props.mobile ? 'flex flex-wrap items-center gap-3' : 'hidden md:flex items-center gap-3'">
    <li>
      <UTooltip text="商业版 · 公号三刀（更稳定 · 免代理）">
        <UIcon
          @click="gotoLink('https://github.com/zoro-build/wechat')"
          name="i-lucide:crown"
          class="dashboard-action-icon text-amber-500 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-300"
        />
      </UTooltip>
    </li>

    <li>
      <UTooltip text="加入QQ群">
        <UIcon
          @click="modal.open(QQGroupModal)"
          name="i-tdesign:logo-qq-filled"
          class="dashboard-action-icon text-slate-500 hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-300"
        />
      </UTooltip>
    </li>

    <li>
      <UTooltip text="文档">
        <UIcon
          name="i-lucide:book-open"
          @click="gotoLink(docsWebSite)"
          class="dashboard-action-icon text-slate-500 hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-300"
        />
      </UTooltip>
    </li>

    <li>
      <UTooltip text="GitHub">
        <UIcon
          name="i-lucide:github"
          @click="gotoLink('https://github.com/wechat-article/wechat-article-exporter')"
          class="dashboard-action-icon text-slate-500 hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-300"
        />
      </UTooltip>
    </li>
  </ul>
</template>

<style scoped>
.dashboard-action-trigger {
  filter: drop-shadow(0 12px 22px rgba(15, 23, 42, 0.08));
}

.dashboard-action-icon {
  @apply inline-flex size-9 cursor-pointer items-center justify-center rounded-full border border-white/80 bg-white/80 p-2 transition-all duration-200 hover:-translate-y-px hover:bg-white dark:border-white/10 dark:bg-slate-900/80 dark:hover:bg-slate-900;
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.08);
}
</style>
