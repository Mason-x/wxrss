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

  async function validateLogin(options?: { force?: boolean }) {
    const force = Boolean(options?.force);

    if (!loginAccount.value || isLoginExpired(loginAccount.value)) {
      clearLoginState();
      return false;
    }

    const now = Date.now();
    if (!force && authStatus.value === 'authenticated' && now - authCheckedAt.value < AUTH_VALIDATION_TTL_MS) {
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

        authStatus.value = 'authenticated';
        authCheckedAt.value = Date.now();

        if (resp.data && loginAccount.value && loginAccount.value.auth_key !== resp.data) {
          loginAccount.value = {
            ...loginAccount.value,
            auth_key: resp.data,
          };
        }

        return true;
      } catch {
        clearLoginState();
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
