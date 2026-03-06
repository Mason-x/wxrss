import { isMemoryDebugEnabled, logMemory } from '~/server/utils/memory-debug';

declare global {
  // eslint-disable-next-line no-var
  var __wxMemoryDebugHooksInstalled: boolean | undefined;
}

export default defineNitroPlugin(nitroApp => {
  if (!isMemoryDebugEnabled()) {
    return;
  }
  if (globalThis.__wxMemoryDebugHooksInstalled) {
    return;
  }
  globalThis.__wxMemoryDebugHooksInstalled = true;

  const onWarning = (warning: Error) => {
    logMemory('process:warning', {
      message: String(warning?.message || ''),
      name: String((warning as any)?.name || ''),
    });
  };
  const onUncaughtMonitor = (error: Error) => {
    logMemory('process:uncaught-exception', {
      message: String(error?.message || ''),
      stack: String(error?.stack || ''),
    });
  };
  const onUnhandled = (reason: unknown) => {
    logMemory('process:unhandled-rejection', {
      reason: String((reason as Error)?.message || reason),
    });
  };
  const onBeforeExit = (code: number) => {
    logMemory('process:before-exit', { code });
  };
  const onExit = (code: number) => {
    logMemory('process:exit', { code });
  };
  const onSigint = () => {
    logMemory('process:sigint');
  };
  const onSigterm = () => {
    logMemory('process:sigterm');
  };

  logMemory('memory-debug:plugin-started');

  process.on('warning', onWarning);
  // Use monitor hook to avoid changing Node's default crash behavior.
  process.on('uncaughtExceptionMonitor', onUncaughtMonitor);
  process.on('unhandledRejection', onUnhandled);
  process.on('beforeExit', onBeforeExit);
  process.on('exit', onExit);
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  nitroApp.hooks.hookOnce('close', () => {
    process.off('warning', onWarning);
    process.off('uncaughtExceptionMonitor', onUncaughtMonitor);
    process.off('unhandledRejection', onUnhandled);
    process.off('beforeExit', onBeforeExit);
    process.off('exit', onExit);
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    globalThis.__wxMemoryDebugHooksInstalled = false;
  });
});
