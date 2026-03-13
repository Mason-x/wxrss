import { $fetch as ofetch } from 'ofetch';

type RuntimeFetch = typeof ofetch;

let cachedBaseFetch: RuntimeFetch | null = null;
let cachedRequest: RuntimeFetch | null = null;

function resolveBaseFetch(): RuntimeFetch {
  const runtimeFetch = (globalThis as typeof globalThis & { $fetch?: RuntimeFetch }).$fetch;
  return typeof runtimeFetch === 'function' ? runtimeFetch : ofetch;
}

function getRequestClient(): RuntimeFetch {
  const baseFetch = resolveBaseFetch();
  if (cachedRequest && cachedBaseFetch === baseFetch) {
    return cachedRequest;
  }

  cachedBaseFetch = baseFetch;
  cachedRequest = baseFetch.create({
    retry: 0,
    method: 'GET',
    async onResponse() {
      // This wrapper may run on both client and server.
    },
    async onResponseError() {},
  });

  return cachedRequest;
}

/**
 * Wrap fetch without retries and avoid touching Nuxt global $fetch during module evaluation.
 */
export const request = ((...args: Parameters<RuntimeFetch>) => {
  const client = getRequestClient();
  return client(...args);
}) as RuntimeFetch;
