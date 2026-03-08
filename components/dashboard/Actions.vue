<script setup lang="ts">
import type { ChipColor } from '#ui/types';
import CredentialsDialog, { type CredentialState } from '~/components/global/CredentialsDialog.vue';
import { docsWebSite } from '~/config';
import { gotoLink } from '~/utils';

const props = withDefaults(
  defineProps<{
    mobile?: boolean;
  }>(),
  {
    mobile: false,
  }
);

const credentialsDialogOpen = ref(false);
const credentialState = ref<CredentialState>('inactive');
const credentialPendingCount = ref(0);
const credentialColor: ComputedRef<ChipColor> = computed<ChipColor>(() => {
  switch (credentialState.value) {
    case 'active':
      return 'green';
    case 'inactive':
      return 'gray';
    case 'warning':
      return 'amber';
    default:
      return 'gray';
  }
});

const credentialBadgeText = computed(() => {
  const count = credentialPendingCount.value;
  if (count <= 0) return '';
  return count > 9 ? '+' : `${count}`;
});
const isCredentialActive = computed(() => credentialState.value === 'active');
</script>

<template>
  <ul :class="props.mobile ? 'flex flex-wrap items-center gap-3' : 'hidden md:flex items-center gap-3'">
    <li>
      <CredentialsDialog
        v-model:open="credentialsDialogOpen"
        v-model:state="credentialState"
        @update:pending-count="credentialPendingCount = $event"
      />
      <UTooltip text="抓取 Credentials">
        <div class="dashboard-action-trigger relative">
          <UIcon
            @click="credentialsDialogOpen = true"
            name="i-lucide:dog"
            :class="[
              'dashboard-action-icon',
              { 'text-slate-500 hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-300': !isCredentialActive },
              { 'text-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-300': isCredentialActive },
            ]"
          />
          <span
            v-if="credentialBadgeText"
            class="absolute -right-1 -top-1 min-w-[16px] rounded-full bg-rose-500 px-1.5 py-0.5 text-center text-[10px] leading-none text-white shadow-[0_10px_18px_rgba(244,63,94,0.28)]"
          >
            {{ credentialBadgeText }}
          </span>
        </div>
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
