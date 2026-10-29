/** Bound this read-only view without changing mutation or paid-job timeouts. */
export async function readWeeklyQueueOverview<T>(
  load: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  timeoutMs = 15_000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel = () => {};
  try {
    const stopped = new Promise<never>((_resolve, reject) => {
      cancel = () => {
        controller.abort();
        reject(new DOMException('视图已关闭', 'AbortError'));
      };
      signal.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('周任务读取超时，请稍后重试。现有计划和后台任务不受影响。'));
      }, timeoutMs);
    });
    if (signal.aborted) cancel();
    return await Promise.race([stopped, signal.aborted ? stopped : load(controller.signal)]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
    controller.abort();
  }
}
