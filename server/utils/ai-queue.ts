const AI_TASK_QUEUES = new Map<string, Promise<void>>();

export async function enqueueAiTask<T>(authKey: string, task: () => Promise<T>): Promise<T> {
  const key = String(authKey || '').trim();
  if (!key) {
    return await task();
  }

  const previous = AI_TASK_QUEUES.get(key) || Promise.resolve();
  const nextTask = previous.catch(() => undefined).then(task);
  const queueMarker = nextTask.then(
    () => undefined,
    () => undefined
  );

  AI_TASK_QUEUES.set(key, queueMarker);

  try {
    return await nextTask;
  } finally {
    if (AI_TASK_QUEUES.get(key) === queueMarker) {
      AI_TASK_QUEUES.delete(key);
    }
  }
}
