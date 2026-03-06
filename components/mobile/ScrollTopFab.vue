<script setup lang="ts">
defineProps<{
  visible: boolean;
}>();

defineEmits<{
  click: [];
}>();
</script>

<template>
  <Transition name="scroll-top-fab">
    <UButton
      v-if="visible"
      color="gray"
      variant="solid"
      icon="i-lucide:chevron-up"
      class="scroll-top-fab"
      @click="$emit('click')"
    />
  </Transition>
</template>

<style scoped>
.scroll-top-fab {
  @apply fixed bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] right-4 z-40 !inline-flex size-11 !p-0 !gap-0 items-center justify-center rounded-full
    border border-slate-200 bg-white/95 text-slate-700 shadow-[0_12px_28px_rgba(15,23,42,0.18)] backdrop-blur
    dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200;
}

.scroll-top-fab :deep(.iconify),
.scroll-top-fab :deep([class*='i-']) {
  width: 16px !important;
  height: 16px !important;
}

.scroll-top-fab-enter-active,
.scroll-top-fab-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}

.scroll-top-fab-enter-from,
.scroll-top-fab-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.92);
}
</style>
