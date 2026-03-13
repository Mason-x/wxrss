type AiTaskPriority = 'interactive' | 'background';

interface AiTaskQueueJob<T> {
  task: () => Promise<T>;
  priority: AiTaskPriority;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

interface AiTaskQueueState {
  running: boolean;
  interactiveJobs: AiTaskQueueJob<unknown>[];
  backgroundJobs: AiTaskQueueJob<unknown>[];
}

interface EnqueueAiTaskOptions {
  priority?: AiTaskPriority;
}

const AI_TASK_QUEUES = new Map<string, AiTaskQueueState>();

function getOrCreateAiTaskQueueState(key: string): AiTaskQueueState {
  const existing = AI_TASK_QUEUES.get(key);
  if (existing) {
    return existing;
  }

  const created: AiTaskQueueState = {
    running: false,
    interactiveJobs: [],
    backgroundJobs: [],
  };

  AI_TASK_QUEUES.set(key, created);
  return created;
}

function getNextAiTaskQueueJob(state: AiTaskQueueState): AiTaskQueueJob<unknown> | undefined {
  return state.interactiveJobs.shift() || state.backgroundJobs.shift();
}

async function drainAiTaskQueue(key: string): Promise<void> {
  const state = AI_TASK_QUEUES.get(key);
  if (!state || state.running) {
    return;
  }

  state.running = true;

  try {
    let job = getNextAiTaskQueueJob(state);
    while (job) {
      try {
        job.resolve(await job.task());
      } catch (error) {
        job.reject(error);
      }

      job = getNextAiTaskQueueJob(state);
    }
  } finally {
    state.running = false;
    if (state.interactiveJobs.length === 0 && state.backgroundJobs.length === 0) {
      AI_TASK_QUEUES.delete(key);
    }
  }
}

export async function enqueueAiTask<T>(
  authKey: string,
  task: () => Promise<T>,
  options: EnqueueAiTaskOptions = {}
): Promise<T> {
  const key = String(authKey || '').trim();
  if (!key) {
    return await task();
  }

  const state = getOrCreateAiTaskQueueState(key);
  const priority = options.priority === 'interactive' ? 'interactive' : 'background';

  const promise = new Promise<T>((resolve, reject) => {
    const job: AiTaskQueueJob<T> = {
      task,
      priority,
      resolve,
      reject,
    };

    if (job.priority === 'interactive') {
      state.interactiveJobs.push(job as AiTaskQueueJob<unknown>);
    } else {
      state.backgroundJobs.push(job as AiTaskQueueJob<unknown>);
    }
  });

  void drainAiTaskQueue(key);
  return await promise;
}
