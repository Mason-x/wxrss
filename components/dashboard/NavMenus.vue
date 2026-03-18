<script setup lang="ts">
interface NavItem {
  name: string;
  icon: string;
  href: string;
  insider?: boolean;
  tags?: string[];
}

const loginAccount = useLoginAccount();

const items = computed<NavItem[]>(() => {
  const isAdmin = loginAccount.value?.role === 'admin';
  const list: NavItem[] = [
    { name: '阅读', icon: 'i-lucide:newspaper', href: '/dashboard/reader' },
    { name: '单篇', icon: 'i-lucide:file-text', href: '/dashboard/single' },
    { name: '文章', icon: 'i-lucide:table-properties', href: '/dashboard/article' },
    { name: '设置', icon: 'i-lucide:settings-2', href: '/dashboard/settings' },
  ];

  if (isAdmin) {
    list.push({ name: '用户管理', icon: 'i-lucide:shield-check', href: '/dashboard/users' });
  }

  return list;
});
</script>

<template>
  <nav class="flex-1">
    <div class="mb-3 px-1">
      <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Navigation</p>
    </div>

    <ul class="flex flex-col gap-2">
      <li v-for="item in items" :key="item.name">
        <NuxtLink :to="item.href" class="nav-link group flex min-h-[48px] items-center gap-3 rounded-[22px] px-3">
          <span
            class="nav-link-icon inline-flex size-9 shrink-0 items-center justify-center rounded-2xl bg-white/70 text-slate-500 shadow-[0_10px_22px_rgba(15,23,42,0.05)] dark:bg-slate-900/80 dark:text-slate-400"
          >
            <UIcon :name="item.icon" class="size-4.5 opacity-90" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{{ item.name }}</p>
          </div>
          <UBadge v-for="tag in item.tags" :key="tag" color="fuchsia" variant="subtle">{{ tag }}</UBadge>
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.nav-link {
  @apply border border-transparent text-slate-600 transition-all duration-200 dark:text-slate-300;
}

.nav-link.router-link-active {
  @apply bg-white text-slate-950 shadow-[0_18px_36px_rgba(15,23,42,0.08)]
    dark:border-white/10 dark:bg-slate-900 dark:text-slate-100;
}

.nav-link:not(.router-link-active):hover {
  @apply -translate-y-px border-white/70 bg-white/70 text-slate-900 shadow-[0_12px_26px_rgba(15,23,42,0.06)]
    dark:border-white/10 dark:bg-slate-900/70 dark:text-slate-100;
}

.nav-link.router-link-active .nav-link-icon {
  @apply bg-orange-50 text-orange-500 dark:bg-orange-500/10 dark:text-orange-300;
}

.nav-link:not(.router-link-active):hover .nav-link-icon {
  @apply bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-200;
}
</style>
