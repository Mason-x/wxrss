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

const stageLabel = computed(() => {
  switch (stage.value) {
    case 'ready':
      return '待扫码';
    case 'confirming':
      return '待确认';
    case 'error':
      return '异常';
    default:
      return '生成中';
  }
});

const stageClass = computed(() => {
  switch (stage.value) {
    case 'ready':
      return 'bg-emerald-500/12 text-emerald-600 ring-1 ring-emerald-500/15 dark:bg-emerald-400/12 dark:text-emerald-300 dark:ring-emerald-400/20';
    case 'confirming':
      return 'bg-amber-500/12 text-amber-600 ring-1 ring-amber-500/15 dark:bg-amber-400/12 dark:text-amber-300 dark:ring-amber-400/20';
    case 'error':
      return 'bg-rose-500/12 text-rose-600 ring-1 ring-rose-500/15 dark:bg-rose-400/12 dark:text-rose-300 dark:ring-rose-400/20';
    default:
      return 'bg-slate-900/6 text-slate-500 ring-1 ring-slate-900/6 dark:bg-white/10 dark:text-slate-300 dark:ring-white/10';
  }
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
  message.value = '正在生成登录二维码';

  try {
    await newLoginSession();
    qrcodeSrc.value = `/api/web/login/getqrcode?rnd=${Math.random()}`;
    stage.value = 'ready';
    message.value = '请使用微信扫描二维码，并在微信中选择要登录的公众号确认登录。';
    scheduleCheck();
  } catch (error: any) {
    stage.value = 'error';
    message.value = String(error?.message || '获取登录二维码失败');
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
        message.value = '请扫描二维码，并在微信中确认本次登录。';
        scheduleCheck();
        break;
      case 1:
        stage.value = 'confirming';
        message.value = '已确认，正在进入工作台';
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
          message.value = '扫码成功，请在微信里选择公众号后继续确认。';
          scheduleCheck();
        } else {
          stage.value = 'error';
          message.value = '当前微信下没有可登录的公众号，请切换账号后重试。';
        }
        break;
      case 5:
        stage.value = 'error';
        message.value = '当前公众号账号未绑定邮箱，无法扫码登录。';
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
  <main class="relative min-h-screen overflow-hidden px-4 py-4 sm:px-6 sm:py-6">
    <div class="pointer-events-none absolute inset-0 overflow-hidden">
      <div class="login-orb login-orb-primary"></div>
      <div class="login-orb login-orb-secondary"></div>
      <div class="login-grid"></div>
    </div>

    <div class="relative mx-auto flex min-h-[calc(100vh-2rem)] max-w-5xl items-center justify-center">
      <div class="grid w-full gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)]">
        <section class="order-2 app-shell-panel rounded-[32px] p-5 sm:p-7 lg:order-1">
          <div class="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500 dark:border-white/10 dark:bg-slate-900/70 dark:text-slate-300">
            <span class="size-2 rounded-full bg-[var(--app-accent)]"></span>
            MP Login
          </div>

          <div class="mt-5 space-y-4">
            <div class="space-y-3">
              <h1 class="max-w-xl text-[2rem] font-semibold leading-[1.05] tracking-[-0.04em] text-slate-950 dark:text-white sm:text-[2.75rem]">
                扫码登录公众号，进入你的阅读与同步工作台
              </h1>
              <p class="max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300 sm:text-base">
                登录后才会显示文章阅读、同步、设置和导出等全部页面。登录态失效时，系统会自动跳回这里。
              </p>
            </div>

            <div class="grid gap-3 sm:grid-cols-3">
              <div class="app-shell-muted rounded-[24px] p-4">
                <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Step 1</p>
                <p class="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">微信扫码</p>
                <p class="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">使用微信扫描右侧二维码。</p>
              </div>
              <div class="app-shell-muted rounded-[24px] p-4">
                <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Step 2</p>
                <p class="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">选择公众号</p>
                <p class="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">在微信中选择要登录的公众号账号。</p>
              </div>
              <div class="app-shell-muted rounded-[24px] p-4">
                <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Step 3</p>
                <p class="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">进入工作台</p>
                <p class="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">确认后自动跳转回你的目标页面。</p>
              </div>
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
              <div class="rounded-[28px] border border-white/80 bg-white/72 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-slate-950/70">
                <div class="flex items-center gap-3">
                  <span class="inline-flex size-10 items-center justify-center rounded-2xl bg-slate-900 text-white dark:bg-white dark:text-slate-950">
                    <UIcon name="i-lucide:shield-check" class="size-5" />
                  </span>
                  <div>
                    <p class="font-medium text-slate-900 dark:text-slate-100">登录态自动守卫</p>
                    <p class="text-sm text-slate-500 dark:text-slate-400">未登录或过期会自动回到登录页。</p>
                  </div>
                </div>
              </div>
              <div class="rounded-[28px] border border-white/80 bg-white/72 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-slate-950/70">
                <div class="flex items-center gap-3">
                  <span class="inline-flex size-10 items-center justify-center rounded-2xl bg-[var(--app-accent)] text-white">
                    <UIcon name="i-lucide:smartphone" class="size-5" />
                  </span>
                  <div>
                    <p class="font-medium text-slate-900 dark:text-slate-100">移动端优先布局</p>
                    <p class="text-sm text-slate-500 dark:text-slate-400">手机打开直接扫码，不再先弹模态框。</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="order-1 app-shell-panel rounded-[32px] p-4 sm:p-5 lg:order-2">
          <div class="rounded-[28px] border border-white/75 bg-white/84 p-4 shadow-[0_22px_60px_rgba(15,23,42,0.09)] dark:border-white/10 dark:bg-slate-950/84 sm:p-5">
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="text-sm font-medium text-slate-500 dark:text-slate-400">微信公众号登录</p>
                <h2 class="mt-1 text-2xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">扫码确认</h2>
              </div>
              <span class="rounded-full px-3 py-1 text-xs font-semibold" :class="stageClass">{{ stageLabel }}</span>
            </div>

            <div class="mt-5 rounded-[28px] border border-slate-200/70 bg-slate-50/90 p-4 dark:border-slate-800/80 dark:bg-slate-950/90">
              <div class="mx-auto flex aspect-square w-full max-w-[18rem] items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <UIcon
                  v-if="loading"
                  name="i-lucide:loader"
                  :size="36"
                  class="animate-spin text-slate-400 dark:text-slate-500"
                />
                <img
                  v-else-if="qrcodeSrc"
                  :src="qrcodeSrc"
                  alt="微信公众号登录二维码"
                  class="h-full w-full rounded-[20px] object-contain"
                />
                <p v-else class="px-5 text-center text-sm leading-6 text-slate-500 dark:text-slate-400">
                  {{ message || '二维码暂不可用，请刷新后重试。' }}
                </p>
              </div>

              <p class="mt-4 min-h-[48px] text-sm leading-6 text-slate-600 dark:text-slate-300">
                {{ message }}
              </p>

              <div class="mt-4 flex gap-2">
                <UButton
                  color="gray"
                  variant="solid"
                  class="flex-1 justify-center rounded-full"
                  :loading="loading"
                  @click="refreshQrcode"
                >
                  刷新二维码
                </UButton>
              </div>
            </div>

            <div class="mt-4 space-y-2 rounded-[24px] border border-slate-200/70 bg-slate-50/80 p-4 text-sm text-slate-500 dark:border-slate-800/80 dark:bg-slate-950/70 dark:text-slate-400">
              <div class="flex items-start gap-2">
                <UIcon name="i-lucide:arrow-right" class="mt-0.5 size-4 shrink-0 text-[var(--app-accent)]" />
                <p>请在微信里选择你实际要登录的公众号，而不是个人微信身份。</p>
              </div>
              <div class="flex items-start gap-2">
                <UIcon name="i-lucide:arrow-right" class="mt-0.5 size-4 shrink-0 text-[var(--app-accent)]" />
                <p>登录成功后将自动返回到 <span class="font-medium text-slate-900 dark:text-slate-100">{{ redirectTarget }}</span>。</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </main>
</template>

<style scoped>
.login-orb {
  position: absolute;
  border-radius: 9999px;
  filter: blur(40px);
  opacity: 0.72;
}

.login-orb-primary {
  top: -7rem;
  right: -4rem;
  height: 18rem;
  width: 18rem;
  background: radial-gradient(circle, rgba(255, 107, 44, 0.26) 0%, rgba(255, 107, 44, 0) 72%);
}

.login-orb-secondary {
  bottom: -8rem;
  left: -4rem;
  height: 22rem;
  width: 22rem;
  background: radial-gradient(circle, rgba(14, 165, 233, 0.18) 0%, rgba(14, 165, 233, 0) 70%);
}

.login-grid {
  position: absolute;
  inset: 0;
  opacity: 0.24;
  background-image:
    linear-gradient(rgba(148, 163, 184, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.08) 1px, transparent 1px);
  background-size: 20px 20px;
  mask-image: linear-gradient(180deg, rgba(15, 23, 42, 0.7), transparent 84%);
}
</style>
