import { runDueSchedulerJobs } from '~/server/utils/scheduler';

declare global {
  // eslint-disable-next-line no-var
  var __wxSchedulerTimers:
    | {
        started: boolean;
        bootTimer: NodeJS.Timeout | null;
        intervalTimer: NodeJS.Timeout | null;
      }
    | undefined;
}

export default defineNitroPlugin(nitroApp => {
  const devEnabled = process.env.NUXT_ENABLE_DEV_SCHEDULER === 'true';
  const prodEnabled = process.env.NUXT_ENABLE_SCHEDULER === 'true';

  // Scheduler is opt-in now:
  // - dev: set NUXT_ENABLE_DEV_SCHEDULER=true
  // - prod/serve: set NUXT_ENABLE_SCHEDULER=true
  if (import.meta.dev ? !devEnabled : !prodEnabled) {
    return;
  }

  if (!globalThis.__wxSchedulerTimers) {
    globalThis.__wxSchedulerTimers = {
      started: false,
      bootTimer: null,
      intervalTimer: null,
    };
  }
  if (globalThis.__wxSchedulerTimers.started) {
    return;
  }
  globalThis.__wxSchedulerTimers.started = true;

  let running = false;

  const tick = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await runDueSchedulerJobs();
    } catch (error) {
      console.error('[scheduler] tick failed:', error);
    } finally {
      running = false;
    }
  };

  globalThis.__wxSchedulerTimers.bootTimer = setTimeout(() => {
    tick();
  }, 5000);

  globalThis.__wxSchedulerTimers.intervalTimer = setInterval(() => {
    tick();
  }, 60 * 1000);

  nitroApp.hooks.hookOnce('close', () => {
    const state = globalThis.__wxSchedulerTimers;
    if (!state) {
      return;
    }
    if (state.bootTimer) {
      clearTimeout(state.bootTimer);
      state.bootTimer = null;
    }
    if (state.intervalTimer) {
      clearInterval(state.intervalTimer);
      state.intervalTimer = null;
    }
    state.started = false;
  });
});
