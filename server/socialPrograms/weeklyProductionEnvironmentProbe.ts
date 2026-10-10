import { evaluateWeeklyProductionEnvironment } from './weeklyProductionEnvironmentReadiness.js';

export async function probeWeeklyProductionEnvironment(input: {
  env: NodeJS.ProcessEnv;
  atomicStore: () => boolean | Promise<boolean>;
  queue: () => Promise<void>;
  timeoutMs?: number;
}) {
  // Exceptions may contain connection strings or credentials. Return stable
  // reason codes only, and still collect all independent readiness failures.
  const bounded = async <T>(probe: () => T | Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(probe),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('probe_timeout')), input.timeoutMs ?? 10000); }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  };
  const [atomic, queue] = await Promise.allSettled([
    bounded(input.atomicStore),
    bounded(input.queue),
  ]);
  const report = evaluateWeeklyProductionEnvironment(input.env, atomic.status === 'fulfilled' && atomic.value === true);
  const queueReady = queue.status === 'fulfilled' && input.env.QUEUE_BACKEND === 'bullmq';
  report.checks.push({ key: 'durable_worker_queue_connection', ready: queueReady, reason: queueReady ? null : 'durable_worker_queue_unavailable' });
  report.ready = report.checks.every(check => check.ready);
  return report;
}
