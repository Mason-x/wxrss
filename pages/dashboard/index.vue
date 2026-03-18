<template>
  <div class="flex h-full items-center justify-center px-6 text-sm text-slate-500 dark:text-slate-400">
    正在进入管理台...
  </div>
</template>

<script setup lang="ts">
const loginAccount = useLoginAccount();

onMounted(() => {
  void navigateTo(loginAccount.value?.role === 'admin' ? '/dashboard/users' : '/dashboard/settings', {
    replace: true,
  });
});
</script>
