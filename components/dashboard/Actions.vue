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
  <ul :class="props.mobile ? 'flex flex-wrap items-center gap-5' : 'hidden md:flex items-center gap-5'">
    <li>
      <CredentialsDialog
        v-model:open="credentialsDialogOpen"
        v-model:state="credentialState"
        @update:pending-count="credentialPendingCount = $event"
      />
      <UTooltip text="抓取 Credentials">
        <div class="relative">
          <UIcon
            @click="credentialsDialogOpen = true"
            name="i-lucide:dog"
            :class="[
              'size-7 cursor-pointer transition-colors',
              { 'text-zinc-400 hover:text-blue-500': !isCredentialActive },
              { 'text-green-500 hover:text-green-600': isCredentialActive },
            ]"
          />
          <span
            v-if="credentialBadgeText"
            class="absolute -right-1 -top-1 min-w-[16px] rounded-full bg-rose-500 px-1.5 py-0.5 text-center text-[10px] leading-none text-white"
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
          class="size-7 cursor-pointer text-zinc-400 transition-colors hover:text-blue-500"
        />
      </UTooltip>
    </li>
  </ul>
</template>
