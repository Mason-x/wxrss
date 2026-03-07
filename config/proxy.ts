export const LEGACY_PUBLIC_PROXY_HOSTS = Object.freeze([
  'worker-proxy.asia',
  'net-proxy.asia',
  'workers-proxy.top',
  'workers-proxy.shop',
  'workers-proxy-1.shop',
  'workers-proxy-2.shop',
]);

export const PRIVATE_PROXY_REQUIRED_MESSAGE =
  '请先在设置中配置私有代理节点。当前版本已禁用内置公共代理与外部代理遥测。';

export interface PrivateProxyValidationResult {
  proxies: string[];
  invalid: string[];
  rejectedLegacy: string[];
}

function normalizeProxyUrl(value: string): string | null {
  const candidate = value.trim();
  if (!candidate) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }

  url.hash = '';
  const normalized = url.toString();
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

export function isLegacyPublicProxyHost(hostname: string): boolean {
  const normalizedHost = hostname.trim().toLowerCase();
  if (!normalizedHost) {
    return false;
  }

  return LEGACY_PUBLIC_PROXY_HOSTS.some(
    host => normalizedHost === host || normalizedHost.endsWith(`.${host}`)
  );
}

export function isLegacyPublicProxyUrl(value: string): boolean {
  const normalized = normalizeProxyUrl(value);
  if (!normalized) {
    return false;
  }

  return isLegacyPublicProxyHost(new URL(normalized).hostname);
}

export function validatePrivateProxyList(values: string[]): PrivateProxyValidationResult {
  const proxies: string[] = [];
  const invalid: string[] = [];
  const rejectedLegacy: string[] = [];
  const seen = new Set<string>();

  values.forEach(value => {
    const normalized = normalizeProxyUrl(value);
    if (!normalized) {
      const trimmed = value.trim();
      if (trimmed) {
        invalid.push(trimmed);
      }
      return;
    }

    if (isLegacyPublicProxyHost(new URL(normalized).hostname)) {
      rejectedLegacy.push(normalized);
      return;
    }

    if (seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    proxies.push(normalized);
  });

  return {
    proxies,
    invalid,
    rejectedLegacy,
  };
}

export function sanitizePrivateProxyList(values: string[]): string[] {
  return validatePrivateProxyList(values).proxies;
}
