<template>
  <form class="flex items-center gap-2" @submit.prevent="search">
    <UInput
      v-model="query"
      icon="i-heroicons-magnifying-glass-20-solid"
      color="white"
      required
      size="md"
      class="search-account-input flex-1"
      :trailing="false"
      placeholder="搜索公众号名称"
      autocomplete="off"
      autocapitalize="off"
      autocorrect="off"
      spellcheck="false"
    />
    <UButton
      type="submit"
      color="gray"
      variant="soft"
      icon="i-lucide:search"
      class="search-account-submit"
      aria-label="搜索公众号"
    />
  </form>
</template>

<script setup lang="ts">
const query = defineModel<string>();
const emit = defineEmits(['search']);

function search() {
  emit('search', query.value);
}
</script>

<style scoped>
.search-account-input :deep(input) {
  font-size: 16px;
}

@media (min-width: 768px) {
  .search-account-input :deep(input) {
    font-size: 14px;
  }
}

.search-account-submit {
  @apply !inline-flex h-10 w-10 shrink-0 items-center justify-center !p-0;
}
</style>
