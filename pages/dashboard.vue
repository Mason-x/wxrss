<template>
  <div class="h-screen">
    <template v-if="standaloneMode">
      <NuxtPage />
    </template>
    <template v-else>
      <div class="flex h-screen">
        <SideBar />

        <div class="flex flex-col flex-1 overflow-hidden h-screen">
          <div
            class="flex h-[60px] flex-shrink-0 items-center justify-between border-b border-slate-6 dark:border-slate-600 px-6"
          >
            <div id="title"></div>
            <GlobalActions />
          </div>

          <div class="flex-1 overflow-hidden">
            <NuxtPage />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import GlobalActions from '~/components/dashboard/Actions.vue';
import SideBar from '~/components/dashboard/SideBar.vue';

const route = useRoute();
const readerMode = computed(() => route.path.startsWith('/dashboard/reader'));
const embeddedMode = computed(() => {
  const value = route.query.embed;
  if (Array.isArray(value)) {
    return value.includes('1');
  }
  return value === '1';
});
const standaloneMode = computed(() => readerMode.value || embeddedMode.value);
</script>
