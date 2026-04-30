<script setup lang="ts">
import { request } from '#shared/utils/request';

interface StorageUsageSummary {
  totalBytes: number;
}

const usage = ref('');
const label = ref('服务端缓存占用约为');

function formatBytes(bytes: number) {
  const value = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (value < 1000) {
    return `${value} B`;
  }
  if (value < 1000 ** 2) {
    return `${(value / 1000).toFixed(0)} kB`;
  }
  if (value < 1000 ** 3) {
    return `${(value / 1000 ** 2).toFixed(1)} M`;
  }
  return `${(value / 1000 ** 3).toFixed(1)} G`;
}

async function getLocalUsage() {
  const storageUsage = await navigator.storage?.estimate?.();
  return Number(storageUsage?.usage || 0);
}

async function init() {
  try {
    const response = await request<{ data?: StorageUsageSummary }>('/api/web/storage-usage');
    label.value = '服务端缓存占用约为';
    usage.value = formatBytes(Number(response?.data?.totalBytes || 0));
    return;
  } catch {
    label.value = '浏览器本地占用约为';
  }

  usage.value = formatBytes(await getLocalUsage());
}

let timer: number;
onMounted(() => {
  init();
  timer = window.setInterval(() => {
    init();
  }, 10_000);
});
onUnmounted(() => {
  window.clearInterval(timer);
});
</script>

<template>
  <p class="text-sm">
    {{ label }} <span class="text-rose-500">{{ usage }}</span>
  </p>
</template>
