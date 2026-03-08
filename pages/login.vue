<script setup lang="ts">
import { request } from '#shared/utils/request';
import type { LoginAccount, ScanLoginResult, StartLoginResult } from '~/types/types';

type LoginStage = 'loading' | 'ready' | 'confirming' | 'error';

const route = useRoute();
const loginAccount = useLoginAccount();
const { resolvePostLoginRedirect } = useMpAuth();

const qrcodeSrc = ref('');
const loading = ref(false);
const message = ref('');
const stage = ref<LoginStage>('loading');

const redirectTarget = computed(() => resolvePostLoginRedirect(route.query.redirect));

const statusText = computed(() => {
  if (message.value) {
    return message.value;
  }

  switch (stage.value) {
    case 'confirming':
      return '请在微信中确认登录';
    case 'error':
      return '二维码不可用，请刷新重试';
    case 'ready':
      return '请使用微信扫码登录公众号';
    default:
      return '二维码生成中';
  }
});

const statusClass = computed(() => {
  if (stage.value === 'error') {
    return 'text-rose-500';
  }

  return 'text-slate-500 dark:text-slate-400';
});

let checkTimer: number | null = null;

onMounted(() => {
  void refreshQrcode();
});

onUnmounted(() => {
  stopChecking();
});

function stopChecking() {
  if (checkTimer !== null) {
    window.clearTimeout(checkTimer);
    checkTimer = null;
  }
}

function scheduleCheck() {
  stopChecking();
  checkTimer = window.setTimeout(checkQrcodeStatus, 1800);
}

async function newLoginSession() {
  const sid = `${Date.now()}${Math.floor(Math.random() * 100)}`;
  const resp = await request<StartLoginResult>(`/api/web/login/session/${sid}`, { method: 'POST' });
  if (!resp?.base_resp || resp.base_resp.ret !== 0) {
    throw new Error(resp?.base_resp?.err_msg || '创建登录会话失败');
  }
}

async function refreshQrcode() {
  stopChecking();
  qrcodeSrc.value = '';
  loading.value = true;
  stage.value = 'loading';
  message.value = '二维码生成中';

  try {
    await newLoginSession();
    qrcodeSrc.value = `/api/web/login/getqrcode?rnd=${Math.random()}`;
    stage.value = 'ready';
    message.value = '请使用微信扫码登录公众号';
    scheduleCheck();
  } catch (error: any) {
    stage.value = 'error';
    message.value = String(error?.message || '获取二维码失败');
  } finally {
    loading.value = false;
  }
}

async function checkQrcodeStatus() {
  try {
    const resp = await request<ScanLoginResult>('/api/web/login/scan');
    if (!resp?.base_resp || resp.base_resp.ret !== 0) {
      throw new Error(resp?.base_resp?.err_msg || '登录状态检查失败');
    }

    switch (resp.status) {
      case 0:
        stage.value = 'ready';
        message.value = '请使用微信扫码登录公众号';
        scheduleCheck();
        break;
      case 1:
        stage.value = 'confirming';
        message.value = '请在微信中确认登录';
        await finalizeLogin();
        break;
      case 2:
      case 3:
        await refreshQrcode();
        break;
      case 4:
      case 6:
        qrcodeSrc.value = '';
        if (resp.acct_size >= 1) {
          stage.value = 'confirming';
          message.value = '请在微信中选择公众号后确认';
          scheduleCheck();
        } else {
          stage.value = 'error';
          message.value = '当前微信没有可登录的公众号';
        }
        break;
      case 5:
        stage.value = 'error';
        message.value = '当前公众号未绑定邮箱，无法扫码登录';
        break;
      default:
        scheduleCheck();
        break;
    }
  } catch (error: any) {
    stage.value = 'error';
    message.value = String(error?.message || '登录状态检查失败');
  }
}

async function finalizeLogin() {
  try {
    loading.value = true;
    const resp = await request<LoginAccount>('/api/web/login/bizlogin', { method: 'POST' });
    if (resp.err) {
      throw new Error(resp.err);
    }

    loginAccount.value = resp;
    await navigateTo(redirectTarget.value, { replace: true });
  } catch (error: any) {
    stage.value = 'error';
    qrcodeSrc.value = '';
    message.value = String(error?.message || '登录失败，请刷新二维码后重试');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-card">
      <div class="login-copy">
        <h1>扫码登录公众号</h1>
        <p>登录后即可访问全部页面</p>
      </div>

      <div class="login-qr-shell">
        <div class="login-qr-box">
          <UIcon
            v-if="loading"
            name="i-lucide:loader"
            :size="34"
            class="animate-spin text-slate-400 dark:text-slate-500"
          />
          <img
            v-else-if="qrcodeSrc"
            :src="qrcodeSrc"
            alt="微信公众号登录二维码"
            class="login-qr-image"
          />
          <p v-else class="login-empty">
            二维码不可用
          </p>
        </div>
      </div>

      <p class="login-status" :class="statusClass">
        {{ statusText }}
      </p>

      <UButton
        color="gray"
        variant="solid"
        class="login-refresh"
        :loading="loading"
        @click="refreshQrcode"
      >
        刷新二维码
      </UButton>
    </section>
  </main>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background:
    radial-gradient(circle at top, rgba(255, 255, 255, 0.96), rgba(248, 250, 252, 0.98) 38%, #f8fafc 100%);
}

.dark .login-page {
  background:
    radial-gradient(circle at top, rgba(30, 41, 59, 0.9), rgba(15, 23, 42, 0.98) 42%, #0f172a 100%);
}

.login-card {
  width: min(100%, 24rem);
  padding: 24px;
  border-radius: 32px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.1);
  backdrop-filter: blur(18px);
}

.dark .login-card {
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(15, 23, 42, 0.88);
  box-shadow: 0 24px 80px rgba(2, 6, 23, 0.55);
}

.login-copy {
  text-align: center;
}

.login-copy h1 {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.04em;
  color: rgb(15 23 42);
}

.dark .login-copy h1 {
  color: white;
}

.login-copy p {
  margin: 8px 0 0;
  font-size: 0.95rem;
  color: rgb(100 116 139);
}

.dark .login-copy p {
  color: rgb(148 163 184);
}

.login-qr-shell {
  margin-top: 20px;
  border-radius: 28px;
  background: rgba(248, 250, 252, 0.9);
  border: 1px solid rgba(226, 232, 240, 0.9);
  padding: 16px;
}

.dark .login-qr-shell {
  background: rgba(2, 6, 23, 0.68);
  border-color: rgba(51, 65, 85, 0.92);
}

.login-qr-box {
  aspect-ratio: 1;
  width: 100%;
  border-radius: 24px;
  background: white;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.dark .login-qr-box {
  background: rgb(15 23 42);
}

.login-qr-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.login-empty {
  margin: 0;
  padding: 0 16px;
  text-align: center;
  font-size: 0.95rem;
  color: rgb(100 116 139);
}

.dark .login-empty {
  color: rgb(148 163 184);
}

.login-status {
  min-height: 1.5rem;
  margin: 16px 0 0;
  text-align: center;
  font-size: 0.9rem;
}

.login-refresh {
  width: 100%;
  margin-top: 16px;
  justify-content: center;
  border-radius: 9999px;
}
</style>
