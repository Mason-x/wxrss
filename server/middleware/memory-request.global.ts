import { isMemoryDebugEnabled, logMemory } from '~/server/utils/memory-debug';

function isRouteMemoryDebugEnabled(): boolean {
  return isMemoryDebugEnabled() && process.env.NUXT_DEBUG_MEMORY_ROUTES === 'true';
}

export default defineEventHandler(event => {
  if (!isRouteMemoryDebugEnabled()) {
    return;
  }

  const url = getRequestURL(event);
  if (!url.pathname.startsWith('/api/')) {
    return;
  }

  const traceId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const startedAt = Date.now();
  logMemory('api-request:start', {
    traceId,
    method: event.method,
    path: url.pathname,
    queryLength: url.search.length,
  });

  let finalized = false;
  const finalize = (stage: 'finish' | 'close') => {
    if (finalized) {
      return;
    }
    finalized = true;
    logMemory(`api-request:${stage}`, {
      traceId,
      method: event.method,
      path: url.pathname,
      statusCode: event.node.res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  };

  event.node.res.once('finish', () => finalize('finish'));
  event.node.res.once('close', () => finalize('close'));
});
