import { evaluateWeeklyProductionEnvironment } from './weeklyProductionEnvironmentReadiness.js';
import type { DataStore } from '../storage/datastore.js';

type WorkerHeartbeatRow = {
  role?: unknown;
  state?: unknown;
  last_seen_at?: unknown;
  details?: unknown;
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object'
  ? value as Record<string, unknown> : {};

/** Read-only evidence that this exact build has a fresh worker which completed
 * background startup (including the content queue worker). */
export async function probeContentWorkerHeartbeat(input: {
  dataStore: DataStore;
  expectedBuildSha: string;
  now?: Date;
  maxAgeMs?: number;
}): Promise<boolean> {
  if (!/^[a-f0-9]{7,64}$/i.test(input.expectedBuildSha)) return false;
  const rows = await input.dataStore.list<WorkerHeartbeatRow>('social_operating_worker_heartbeats', {
    where: { state: 'ready' }, sort: '-last_seen_at', page: 1, perPage: 20,
  });
  const now = (input.now ?? new Date()).getTime();
  const maxAgeMs = Math.min(Math.max(input.maxAgeMs ?? 60_000, 5_000), 300_000);
  return rows.items.some(row => {
    if (row.state !== 'ready' || !['worker', 'all'].includes(String(row.role || ''))) return false;
    const age = now - Date.parse(String(row.last_seen_at || ''));
    const build = record(record(row.details).build);
    const weekly = record(record(row.details).weeklyExecution);
    const starter = record(record(row.details).starterContentWorkers);
    return Number.isFinite(age) && age >= 0 && age <= maxAgeMs
      && String(build.commitSha || '').toLowerCase() === input.expectedBuildSha.toLowerCase()
      && weekly.configuredEnabled === true
      && weekly.started === true
      && ['waiting', 'scanning', 'idle'].includes(String(weekly.state || ''))
      && starter.ready === true;
  });
}

export async function probeWeeklyProductionEnvironment(input: {
  env: NodeJS.ProcessEnv;
  atomicStore: () => boolean | Promise<boolean>;
  contentOrderAtomicStore?: () => boolean | Promise<boolean>;
  queue: () => Promise<void>;
  /** Must prove that a checkpoint can be durably written and read back. */
  langgraphCheckpointStore?: () => boolean | Promise<boolean>;
  /** Must read a fresh, ready content-worker heartbeat from durable storage. */
  contentWorkerHeartbeat?: () => boolean | Promise<boolean>;
  /** Must observe a canary enqueued by the web process being claimed by a worker. */
  webToWorkerJobClaim?: () => boolean | Promise<boolean>;
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
  const missingProbe = async () => false;
  const [atomic, contentOrderAtomic, queue, checkpoint, heartbeat, jobClaim] = await Promise.allSettled([
    bounded(input.atomicStore),
    bounded(input.contentOrderAtomicStore ?? (() => false)),
    bounded(input.queue),
    bounded(input.langgraphCheckpointStore ?? missingProbe),
    bounded(input.contentWorkerHeartbeat ?? missingProbe),
    bounded(input.webToWorkerJobClaim ?? missingProbe),
  ]);
  const report = evaluateWeeklyProductionEnvironment(
    input.env,
    atomic.status === 'fulfilled' && atomic.value === true,
    contentOrderAtomic.status === 'fulfilled' && contentOrderAtomic.value === true,
  );
  const queueReady = queue.status === 'fulfilled' && input.env.QUEUE_BACKEND === 'bullmq';
  report.checks.push({ key: 'durable_worker_queue_connection', ready: queueReady, reason: queueReady ? null : 'durable_worker_queue_unavailable' });
  const runtimeChecks = [
    ['langgraph_checkpoint_store', checkpoint, 'langgraph_checkpoint_store_unverified'],
    ['content_worker_heartbeat', heartbeat, 'content_worker_heartbeat_unverified'],
    ['web_to_worker_job_claim', jobClaim, 'web_to_worker_job_claim_unverified'],
  ] as const;
  for (const [key, result, reason] of runtimeChecks) {
    const ready = result.status === 'fulfilled' && result.value === true;
    report.checks.push({ key, ready, reason: ready ? null : reason });
  }
  report.ready = report.checks.every(check => check.ready);
  return report;
}
