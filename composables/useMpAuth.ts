import { request } from '#shared/utils/request';
import type { GetAuthKeyResult, LoginAccount } from '~/types/types';

const AUTH_VALIDATION_TTL_MS = 30 * 1000;

let validationPromise: Promise<boolean> | null = null;

function normalizeRedirectTarget(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const target = String(raw || '').trim();
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.startsWith('/login')) {
    return null;
  }
  return target;
}

function getLoginExpiresAt(account: LoginAccount | null | undefined): number {
  const expiresAt = new Date(String(account?.expires || '')).getTime();
  return Number.isFinite(expiresAt) ? expiresAt : 0;
}

function normalizeLoginAccount(account: LoginAccount | null | undefined, authKey?: string): LoginAccount | null {
  const expires = String(account?.expires || '').trim();
  const normalizedAuthKey = String(authKey || account?.auth_key || '').trim();

  if (!expires || !normalizedAuthKey) {
    return null;
  }

  return {
    nickname: String(account?.nickname || '').trim(),
    avatar: String(account?.avatar || '').trim(),
    expires,
    auth_key: normalizedAuthKey,
    identity_key: String(account?.identity_key || '').trim(),
  };
}

export default function useMpAuth() {
  const loginAccount = useLoginAccount();
  const authStatus = useState<'unknown' | 'authenticated' | 'unauthenticated'>('mp-auth-status', () => 'unknown');
  const authCheckedAt = useState<number>('mp-auth-checked-at', () => 0);

  function isPublicRoute(path: string): boolean {
    return path === '/login';
  }

  function isLoginExpired(account: LoginAccount | null | undefined = loginAccount.value): boolean {
    return getLoginExpiresAt(account) <= Date.now();
  }

  function clearLoginState() {
    loginAccount.value = null;
    authStatus.value = 'unauthenticated';
    authCheckedAt.value = Date.now();
  }

  function markAuthenticated(account?: LoginAccount | null) {
    const normalized = normalizeLoginAccount(account || loginAccount.value);
    if (normalized) {
      loginAccount.value = normalized;
    }
    authStatus.value = 'authenticated';
    authCheckedAt.value = Date.now();
  }

  async function validateLogin(options?: { force?: boolean }) {
    const force = Boolean(options?.force);
    const currentAccount = loginAccount.value;
    const hasUsableLocalLogin = Boolean(currentAccount && !isLoginExpired(currentAccount));

    const now = Date.now();
    if (
      !force &&
      hasUsableLocalLogin &&
      authStatus.value === 'authenticated' &&
      now - authCheckedAt.value < AUTH_VALIDATION_TTL_MS
    ) {
      return true;
    }

    if (!force && validationPromise) {
      return validationPromise;
    }

    validationPromise = (async () => {
      try {
        const resp = await request<GetAuthKeyResult>('/api/public/v1/authkey');
        const ok = Number(resp?.code) === 0;

        if (!ok) {
          clearLoginState();
          return false;
        }

        const restoredAccount =
          normalizeLoginAccount(resp?.login || null, resp?.data) ||
          normalizeLoginAccount(loginAccount.value, resp?.data);
        markAuthenticated(restoredAccount);

        return true;
      } catch {
        if (hasUsableLocalLogin) {
          authStatus.value = 'unknown';
          return true;
        }
        return false;
      } finally {
        validationPromise = null;
      }
    })();

    return validationPromise;
  }

  function buildLoginRoute(redirectTarget?: unknown) {
    const redirect = normalizeRedirectTarget(redirectTarget);
    if (redirect) {
      return {
        path: '/login',
        query: { redirect },
      };
    }
    return { path: '/login' };
  }

  async function navigateToLogin(redirectTarget?: unknown) {
    return navigateTo(buildLoginRoute(redirectTarget), { replace: true });
  }

  function resolvePostLoginRedirect(redirectTarget?: unknown) {
    return normalizeRedirectTarget(redirectTarget) || '/';
  }

  return {
    loginAccount,
    isPublicRoute,
    isLoginExpired,
    clearLoginState,
    validateLogin,
    buildLoginRoute,
    navigateToLogin,
    resolvePostLoginRedirect,
  };
}
