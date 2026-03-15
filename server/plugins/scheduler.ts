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
  const rawFlag = import.meta.dev ? process.env.NUXT_ENABLE_DEV_SCHEDULER : process.env.NUXT_ENABLE_SCHEDULER;
  const normalizedFlag = String(rawFlag || '')
    .trim()
    .toLowerCase();

  // Scheduler is enabled by default. Set the env flag to "false" to disable it explicitly.
  if (normalizedFlag === 'false' || normalizedFlag === '0') {
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
