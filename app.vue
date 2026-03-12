<template>
  <div :class="isDev ? 'debug-screens' : ''" class="flex h-screen flex-col">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>

    <UNotifications />
    <UModals />
  </div>
</template>

<script setup lang="ts">
import { ModuleRegistry } from 'ag-grid-community';
import { AllEnterpriseModule, LicenseManager } from 'ag-grid-enterprise';
import { isDev } from '~/config';

const runtimeConfig = useRuntimeConfig();
const route = useRoute();
const { loginAccount, isLoginExpired, isPublicRoute, navigateToLogin } = useMpAuth();
useAppThemeMode();

const authRedirecting = ref(false);

ModuleRegistry.registerModules([AllEnterpriseModule]);
LicenseManager.setLicenseKey(runtimeConfig.public.aggridLicense);

async function ensureProtectedRouteAuth() {
  if (import.meta.server || authRedirecting.value || isPublicRoute(route.path)) {
    return;
  }

  if (!loginAccount.value || isLoginExpired(loginAccount.value)) {
    loginAccount.value = null;
    authRedirecting.value = true;
    try {
      await navigateToLogin(route.fullPath);
    } finally {
      authRedirecting.value = false;
    }
  }
}

let authExpiryTimer: number | null = null;

onMounted(() => {
  void ensureProtectedRouteAuth();
  authExpiryTimer = window.setInterval(() => {
    void ensureProtectedRouteAuth();
  }, 15 * 1000);
});

onUnmounted(() => {
  if (authExpiryTimer !== null) {
    window.clearInterval(authExpiryTimer);
  }
});

watch(
  () => [route.fullPath, loginAccount.value?.expires || '', loginAccount.value?.auth_key || ''],
  () => {
    void ensureProtectedRouteAuth();
  }
);
</script>

<style>
@import 'style.css';
</style>
