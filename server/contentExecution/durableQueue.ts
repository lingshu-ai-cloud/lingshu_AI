import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import { currentDataAuthority, runWithDataAuthority, type DataAuthority } from '../storage/dataAuthority.js';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import {
  acquireDurableOperationLease,
  releaseDurableOperationLease,
  renewDurableOperationLease,
  type DurableOperationLease,
} from '../runtime/durableLease.js';
import {
  CONTENT_EXECUTION_JOB_COLLECTION,
  parseContentExecutionCheckpoints,
  parseContentProviderReceipts,
  runWithContentExecutionContext,
  type ContentExecutionCheckpoints,
  type ContentProviderReceipt,
} from './context.js';
import { classifyContentExecutionFailure, type ContentExecutionRetryDecision } from './retryPolicy.js';

export const CONTENT_EXECUTION_LIMIT_COLLECTION = 'content_execution_limits';

export type ContentExecutionJobStatus =
  | 'queued'
  | 'running'
  | 'retry_wait'
  | 'reconciling'
  | 'blocked'
  | 'paused'
  | 'succeeded'
  | 'cancelled'
  | 'dead_letter';

export type ContentExecutionLimitScope = 'tenant' | 'account' | 'task_type';

export interface ContentExecutionJob {
  id: string;
  tenantId: string;
  jobKey: string;
  taskId: string;
  runId: string;
  userId: string;
  accountId: string;
  taskType: string;
  status: ContentExecutionJobStatus;
  attempt: number;
  reconciliationAttempt: number;
  nextAttemptAt: string | null;
  workerId: string | null;
  leaseExpiresAt: string | null;
  retryClass: string | null;
  lastError: string | null;
  providerState: string;
  providerReceipts: ContentProviderReceipt[];
  checkpoints: ContentExecutionCheckpoints;
  createdAt: string;
  updatedAt: string;
  lastStartedAt: string | null;
  completedAt: string | null;
}

export interface ContentExecutionLimit {
  id: string;
  tenantId: string;
  scope: ContentExecutionLimitScope;
  scopeKey: string;
  maxRunning: number;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

type JobRow = Record<string, unknown> & { id: string };
type LimitRow = Record<string, unknown> & { id: string };

const ACTIVE_STATUSES = new Set<ContentExecutionJobStatus>(['running']);
const CLAIMABLE_STATUSES = ['queued', 'retry_wait', 'reconciling'] as const;
const SAFE_IDENTITY = /^[a-zA-Z0-9._:@-]{1,240}$/;

function text(value: unknown, max = 1000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function integer(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

function dateText(value: unknown): string | null {
  const raw = text(value, 80);
  return raw && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : null;
}

function requiredIdentity(value: unknown, field: string): string {
  const normalized = text(value, 240);
  if (!SAFE_IDENTITY.test(normalized)) throw new Error(`content_execution_${field}_invalid`);
  return normalized;
}

function stableId(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 15);
}

function jobFromRow(row: JobRow): ContentExecutionJob {
  const status = text(row.status, 40) as ContentExecutionJobStatus;
  if (!row.id || !['queued', 'running', 'retry_wait', 'reconciling', 'blocked', 'paused', 'succeeded', 'cancelled', 'dead_letter'].includes(status)) {
    throw new Error('content_execution_job_record_invalid');
  }
  return {
    id: row.id,
    tenantId: requiredIdentity(row.tenant_id, 'tenant'),
    jobKey: requiredIdentity(row.job_key, 'job_key'),
    taskId: requiredIdentity(row.task_id, 'task'),
    runId: requiredIdentity(row.run_id, 'run'),
    userId: requiredIdentity(row.user_id, 'user'),
    accountId: requiredIdentity(row.account_id, 'account'),
    taskType: requiredIdentity(row.task_type, 'task_type'),
    status,
    attempt: integer(row.attempt),
    reconciliationAttempt: integer(row.reconciliation_attempt),
    nextAttemptAt: dateText(row.next_attempt_at),
    workerId: text(row.worker_id, 240) || null,
    leaseExpiresAt: dateText(row.lease_expires_at),
    retryClass: text(row.retry_class, 80) || null,
    lastError: text(row.last_error, 2000) || null,
    providerState: text(row.provider_state, 40) || 'none',
    providerReceipts: parseContentProviderReceipts(row.provider_receipts),
    checkpoints: parseContentExecutionCheckpoints(row.checkpoints),
    createdAt: dateText(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: dateText(row.updated_at) ?? new Date(0).toISOString(),
    lastStartedAt: dateText(row.last_started_at),
    completedAt: dateText(row.completed_at),
  };
}

function limitFromRow(row: LimitRow): ContentExecutionLimit {
  const scope = text(row.limit_scope, 40) as ContentExecutionLimitScope;
  if (!row.id || !['tenant', 'account', 'task_type'].includes(scope)) throw new Error('content_execution_limit_record_invalid');
  const maxRunning = integer(row.max_running);
  if (maxRunning < 1 || maxRunning > 100) throw new Error('content_execution_limit_record_invalid');
  return {
    id: row.id,
    tenantId: requiredIdentity(row.tenant_id, 'tenant'),
    scope,
    scopeKey: row.scope_key === '*' ? '*' : requiredIdentity(row.scope_key, 'scope_key'),
    maxRunning,
    updatedBy: text(row.updated_by, 240),
    createdAt: dateText(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: dateText(row.updated_at) ?? new Date(0).toISOString(),
  };
}

async function listAll<T extends { id: string }>(dataStore: DataStore, collection: string, query: ListQuery = {}): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const result = await dataStore.list<T>(collection, { ...query, page, perPage: 500 });
    rows.push(...result.items);
    if (page >= Math.max(1, result.totalPages)) break;
    if (page === 100) throw new Error(`content_execution_${collection}_scan_limit_exceeded`);
  }
  return rows;
}

export function contentExecutionDefaults(env: NodeJS.ProcessEnv = process.env) {
  const bounded = (value: unknown, fallback: number) => Math.min(Math.max(integer(value, fallback), 1), 100);
  return {
    tenantMaxRunning: bounded(env.CONTENT_MAX_RUNNING_PER_TENANT, 2),
    accountMaxRunning: bounded(env.CONTENT_MAX_RUNNING_PER_ACCOUNT, 1),
    taskTypeMaxRunning: bounded(env.CONTENT_MAX_RUNNING_PER_TASK_TYPE, 2),
    workerConcurrency: bounded(env.CONTENT_EXECUTION_WORKER_CONCURRENCY, 4),
    pollIntervalMs: Math.min(Math.max(integer(env.CONTENT_EXECUTION_POLL_INTERVAL_MS, 2_000), 250), 60_000),
    leaseDurationMs: Math.min(Math.max(integer(env.CONTENT_EXECUTION_LEASE_MS, 30 * 60_000), 60_000), 2 * 60 * 60_000),
  };
}

export async function listContentExecutionLimits(dataStore: DataStore, tenantId: string): Promise<ContentExecutionLimit[]> {
  requiredIdentity(tenantId, 'tenant');
  return (await listAll<LimitRow>(dataStore, CONTENT_EXECUTION_LIMIT_COLLECTION, {
    where: { tenant_id: tenantId }, sort: 'limit_scope,scope_key',
  })).map(limitFromRow);
}

/**
 * Tenant-scoped read model for customer-facing queue observability.
 *
 * Worker identifiers, provider receipts and raw error messages stay on the
 * internal job record. Callers must deliberately project only public fields.
 */
export async function listContentExecutionJobs(
  dataStore: DataStore,
  tenantId: string,
): Promise<ContentExecutionJob[]> {
  requiredIdentity(tenantId, 'tenant');
  return (await listAll<JobRow>(dataStore, CONTENT_EXECUTION_JOB_COLLECTION, {
    where: { tenant_id: tenantId }, sort: '-updated_at',
  })).map(jobFromRow);
}

export async function setContentExecutionLimit(input: {
  dataStore: DataStore;
  tenantId: string;
  scope: ContentExecutionLimitScope;
  scopeKey: string;
  maxRunning: number | null;
  updatedBy: string;
  now?: Date;
}): Promise<ContentExecutionLimit | null> {
  const tenantId = requiredIdentity(input.tenantId, 'tenant');
  const scopeKey = input.scopeKey === '*' ? '*' : requiredIdentity(input.scopeKey, 'scope_key');
  const updatedBy = requiredIdentity(input.updatedBy, 'updated_by');
  if (!['tenant', 'account', 'task_type'].includes(input.scope)) throw new Error('content_execution_limit_scope_invalid');
  if (input.scope === 'tenant' && scopeKey !== '*') throw new Error('content_execution_tenant_limit_key_invalid');
  const id = stableId('content-limit', tenantId, input.scope, scopeKey);
  const existing = await input.dataStore.getById<LimitRow>(CONTENT_EXECUTION_LIMIT_COLLECTION, id);
  if (input.maxRunning === null) {
    if (existing && !await input.dataStore.delete(CONTENT_EXECUTION_LIMIT_COLLECTION, id)) {
      throw new Error('content_execution_limit_delete_failed');
    }
    return null;
  }
  const maxRunning = integer(input.maxRunning);
  if (maxRunning < 1 || maxRunning > 100) throw new Error('content_execution_limit_value_invalid');
  const now = (input.now ?? new Date()).toISOString();
  if (existing) {
    const updated = await input.dataStore.update(CONTENT_EXECUTION_LIMIT_COLLECTION, id, {
      tenant_id: tenantId, limit_scope: input.scope, scope_key: scopeKey,
      max_running: maxRunning, updated_by: updatedBy, updated_at: now,
    });
    if (!updated) throw new Error('content_execution_limit_update_failed');
  } else {
    const created = await input.dataStore.create<LimitRow>(CONTENT_EXECUTION_LIMIT_COLLECTION, {
      id, tenant_id: tenantId, limit_scope: input.scope, scope_key: scopeKey,
      max_running: maxRunning, updated_by: updatedBy, created_at: now, updated_at: now,
    });
    if (!created) throw new Error('content_execution_limit_create_failed');
  }
  const saved = await input.dataStore.getById<LimitRow>(CONTENT_EXECUTION_LIMIT_COLLECTION, id);
  if (!saved) throw new Error('content_execution_limit_readback_failed');
  return limitFromRow(saved);
}

export async function admitContentExecutionJob(input: {
  dataStore: DataStore;
  tenantId: string;
  userId: string;
  taskId: string;
  runId: string;
  accountId?: string | null;
  taskType: string;
  now?: Date;
}): Promise<ContentExecutionJob> {
  const tenantId = requiredIdentity(input.tenantId, 'tenant');
  const userId = requiredIdentity(input.userId, 'user');
  const taskId = requiredIdentity(input.taskId, 'task');
  const runId = requiredIdentity(input.runId, 'run');
  const accountId = requiredIdentity(input.accountId || '_unassigned', 'account');
  const taskType = requiredIdentity(input.taskType, 'task_type');
  const jobKey = createHash('sha256').update([tenantId, taskId, runId, taskType].join('\0')).digest('hex');
  const id = stableId('content-job', jobKey);
  const existing = await input.dataStore.getById<JobRow>(CONTENT_EXECUTION_JOB_COLLECTION, id);
  if (existing) {
    const parsed = jobFromRow(existing);
    if (parsed.jobKey !== jobKey || parsed.tenantId !== tenantId || parsed.taskId !== taskId || parsed.runId !== runId) {
      throw new Error('content_execution_job_id_collision');
    }
    return parsed;
  }
  const now = (input.now ?? new Date()).toISOString();
  const created = await input.dataStore.create<JobRow>(CONTENT_EXECUTION_JOB_COLLECTION, {
    id, tenant_id: tenantId, job_key: jobKey, task_id: taskId, run_id: runId, user_id: userId,
    account_id: accountId, task_type: taskType, status: 'queued', attempt: 0,
    reconciliation_attempt: 0, next_attempt_at: now, worker_id: '', lease_expires_at: '',
    retry_class: '', last_error: '', provider_state: 'none', provider_receipts: [],
    checkpoints: {},
    created_at: now, updated_at: now, last_started_at: '', completed_at: '',
  });
  if (!created) {
    const raced = await input.dataStore.getById<JobRow>(CONTENT_EXECUTION_JOB_COLLECTION, id);
    if (raced) return jobFromRow(raced);
    throw new Error('content_execution_job_create_failed');
  }
  return jobFromRow(created);
}

async function readSchedulerJobs(dataStore: DataStore): Promise<ContentExecutionJob[]> {
  const statuses: ContentExecutionJobStatus[] = ['running', 'queued', 'retry_wait', 'reconciling'];
  const rows = (await Promise.all(statuses.map(status => listAll<JobRow>(
    dataStore,
    CONTENT_EXECUTION_JOB_COLLECTION,
    { where: { status }, sort: 'created_at' },
  )))).flat();
  return rows.map(jobFromRow);
}

function isDue(job: ContentExecutionJob, now: Date): boolean {
  return !job.nextAttemptAt || Date.parse(job.nextAttemptAt) <= now.getTime();
}

function hasProviderWork(job: ContentExecutionJob): boolean {
  return job.providerReceipts.some(receipt => ['submitting', 'accepted', 'unknown'].includes(receipt.state));
}

function effectiveLimit(
  limits: ContentExecutionLimit[],
  scope: ContentExecutionLimitScope,
  key: string,
  fallback: number,
): number {
  return limits.find(item => item.scope === scope && item.scopeKey === key)?.maxRunning
    ?? limits.find(item => item.scope === scope && item.scopeKey === '*')?.maxRunning
    ?? fallback;
}

function canRun(job: ContentExecutionJob, running: ContentExecutionJob[], limits: ContentExecutionLimit[], env: NodeJS.ProcessEnv): boolean {
  const defaults = contentExecutionDefaults(env);
  const tenantRunning = running.filter(item => item.tenantId === job.tenantId);
  if (tenantRunning.length >= effectiveLimit(limits, 'tenant', '*', defaults.tenantMaxRunning)) return false;
  if (tenantRunning.filter(item => item.accountId === job.accountId).length
    >= effectiveLimit(limits, 'account', job.accountId, defaults.accountMaxRunning)) return false;
  if (tenantRunning.filter(item => item.taskType === job.taskType).length
    >= effectiveLimit(limits, 'task_type', job.taskType, defaults.taskTypeMaxRunning)) return false;
  return true;
}

async function recoverAbandonedJobs(dataStore: DataStore, jobs: ContentExecutionJob[], now: Date): Promise<void> {
  for (const job of jobs) {
    if (job.status !== 'running' || !job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) > now.getTime()) continue;
    const reconcile = hasProviderWork(job);
    await dataStore.update(CONTENT_EXECUTION_JOB_COLLECTION, job.id, {
      status: reconcile ? 'reconciling' : 'retry_wait',
      retry_class: reconcile ? 'provider_reconciliation' : 'system_fault',
      next_attempt_at: now.toISOString(),
      worker_id: '', lease_expires_at: '',
      last_error: reconcile ? 'worker_interrupted_after_provider_handoff' : 'worker_interrupted_before_provider_handoff',
      updated_at: now.toISOString(),
    });
  }
}

async function claimNextJob(input: {
  dataStore: DataStore;
  workerId: string;
  env: NodeJS.ProcessEnv;
  now: Date;
}): Promise<{ job: ContentExecutionJob; lease: DurableOperationLease } | null> {
  const defaults = contentExecutionDefaults(input.env);
  const schedulerLease = await acquireDurableOperationLease({
    dataStore: input.dataStore, tenantId: '__system__', scope: 'content_queue_scheduler',
    subjectId: 'global', ownerId: input.workerId, now: input.now, leaseDurationMs: 60_000, reclaimGraceMs: 5_000,
  });
  if (!schedulerLease) return null;
  try {
    let jobs = await readSchedulerJobs(input.dataStore);
    await recoverAbandonedJobs(input.dataStore, jobs, input.now);
    jobs = await readSchedulerJobs(input.dataStore);
    const running = jobs.filter(job => ACTIVE_STATUSES.has(job.status));
    const allTenantIds = [...new Set(jobs.map(job => job.tenantId))];
    const limits = (await Promise.all(allTenantIds.map(tenantId => listContentExecutionLimits(input.dataStore, tenantId)))).flat();
    const candidates = jobs.filter(job => CLAIMABLE_STATUSES.includes(job.status as typeof CLAIMABLE_STATUSES[number]) && isDue(job, input.now));
    candidates.sort((left, right) => {
      const leftRunning = running.filter(item => item.tenantId === left.tenantId).length;
      const rightRunning = running.filter(item => item.tenantId === right.tenantId).length;
      return leftRunning - rightRunning
        || Date.parse(left.createdAt) - Date.parse(right.createdAt)
        || left.id.localeCompare(right.id);
    });
    for (const candidate of candidates) {
      if (!canRun(candidate, running, limits.filter(item => item.tenantId === candidate.tenantId), input.env)) continue;
      const lease = await acquireDurableOperationLease({
        dataStore: input.dataStore, tenantId: candidate.tenantId, scope: 'content_execution_job',
        subjectId: candidate.id, ownerId: input.workerId, now: input.now,
        leaseDurationMs: defaults.leaseDurationMs, reclaimGraceMs: 5_000,
      });
      if (!lease) continue;
      const leaseExpiresAt = new Date(input.now.getTime() + defaults.leaseDurationMs).toISOString();
      const claimed = await input.dataStore.update(CONTENT_EXECUTION_JOB_COLLECTION, candidate.id, {
        status: 'running', attempt: candidate.attempt + 1,
        reconciliation_attempt: candidate.status === 'reconciling' ? candidate.reconciliationAttempt + 1 : candidate.reconciliationAttempt,
        worker_id: input.workerId, lease_expires_at: leaseExpiresAt,
        last_started_at: input.now.toISOString(), updated_at: input.now.toISOString(),
      });
      if (!claimed) {
        await releaseDurableOperationLease({ dataStore: input.dataStore, lease }).catch(() => undefined);
        throw new Error('content_execution_job_claim_failed');
      }
      const row = await input.dataStore.getById<JobRow>(CONTENT_EXECUTION_JOB_COLLECTION, candidate.id);
      if (!row) throw new Error('content_execution_job_claim_readback_failed');
      return { job: jobFromRow(row), lease };
    }
    return null;
  } finally {
    await releaseDurableOperationLease({ dataStore: input.dataStore, lease: schedulerLease });
  }
}

function sameClaim(current: ContentExecutionJob, claimed: ContentExecutionJob): boolean {
  return current.workerId === claimed.workerId && current.attempt === claimed.attempt;
}

async function finishSucceeded(dataStore: DataStore, job: ContentExecutionJob, now: Date): Promise<boolean> {
  const currentRow = await dataStore.getById<JobRow>(CONTENT_EXECUTION_JOB_COLLECTION, job.id);
  const current = currentRow ? jobFromRow(currentRow) : job;
  if (!sameClaim(current, job)) return false;
  if (current.status === 'paused' || current.status === 'cancelled') {
    if (!await dataStore.update(CONTENT_EXECUTION_JOB_COLLECTION, job.id, {
      worker_id: '', lease_expires_at: '', updated_at: now.toISOString(),
    })) throw new Error('content_execution_job_control_settlement_failed');
    return false;
  }
  if (!await dataStore.update(CONTENT_EXECUTION_JOB_COLLECTION, job.id, {
    status: 'succeeded', next_attempt_at: '', worker_id: '', lease_expires_at: '', retry_class: '', last_error: '',
    completed_at: now.toISOString(), updated_at: now.toISOString(),
  })) throw new Error('content_execution_job_completion_failed');
  return true;
}

async function finishFailed(input: {
  dataStore: DataStore;
  job: ContentExecutionJob;
  error: unknown;
  now: Date;
  env: NodeJS.ProcessEnv;
}): Promise<{ decision: ContentExecutionRetryDecision; settled: boolean }> {
  const currentRow = await input.dataStore.getById<JobRow>(CONTENT_EXECUTION_JOB_COLLECTION, input.job.id);
  const current = currentRow ? jobFromRow(currentRow) : input.job;
  if (!sameClaim(current, input.job)) {
    return {
      decision: classifyContentExecutionFailure(input.error, {
        attempt: input.job.attempt,
        hasUnsettledProviderReceipt: hasProviderWork(input.job),
        env: input.env,
      }),
      settled: false,
    };
  }
  if (current.status === 'paused' || current.status === 'cancelled') {
    await input.dataStore.update(CONTENT_EXECUTION_JOB_COLLECTION, current.id, {
      worker_id: '', lease_expires_at: '', updated_at: input.now.toISOString(),
    });
    return { settled: false, decision: {
      failureClass: 'system_fault', disposition: 'block', retryDelayMs: null,
      maxAttempts: 1, publicReason: current.status === 'paused' ? '任务已暂停' : '任务已取消',
    } };
  }
  const providerPending = hasProviderWork(current);
  const reconcileAttempt = Math.max(1, current.reconciliationAttempt);
  const decision = classifyContentExecutionFailure(input.error, {
    attempt: providerPending ? reconcileAttempt : current.attempt,
    hasUnsettledProviderReceipt: providerPending, env: input.env,
  });
  const status: ContentExecutionJobStatus = decision.disposition === 'retry'
    ? 'retry_wait' : decision.disposition === 'reconcile' ? 'reconciling' : 'blocked';
  const nextAttemptAt = decision.retryDelayMs === null ? '' : new Date(input.now.getTime() + decision.retryDelayMs).toISOString();
  const errorText = String(input.error instanceof Error ? input.error.message : input.error || 'content_execution_failed').slice(0, 2000);
  if (!await input.dataStore.update(CONTENT_EXECUTION_JOB_COLLECTION, current.id, {
    status, retry_class: decision.failureClass, next_attempt_at: nextAttemptAt,
    reconciliation_attempt: providerPending ? reconcileAttempt : current.reconciliationAttempt,
    worker_id: '', lease_expires_at: '', last_error: errorText, updated_at: input.now.toISOString(),
  })) throw new Error('content_execution_job_failure_persist_failed');
  return { decision, settled: true };
}

export interface DurableContentExecutionWorkerOptions {
  dataAuthority?: DataAuthority;
  dataStore: DataStore;
  execute(job: ContentExecutionJob): Promise<void>;
  onSucceeded?(job: ContentExecutionJob): Promise<void>;
  onRetry?(job: ContentExecutionJob, error: unknown, decision: ContentExecutionRetryDecision): Promise<void>;
  onBlocked?(job: ContentExecutionJob, error: unknown, decision: ContentExecutionRetryDecision): Promise<void>;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export class DurableContentExecutionWorker {
  private readonly env: NodeJS.ProcessEnv;
  private readonly workerId: string;
  private readonly active = new Map<string, Promise<void>>();
  private draining = false;
  private interval: NodeJS.Timeout | null = null;

  constructor(private readonly options: DurableContentExecutionWorkerOptions) {
    this.env = options.env ?? process.env;
    this.workerId = `${os.hostname().replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80)}-${process.pid}-${randomUUID()}`;
  }

  start(): void {
    if (this.interval) return;
    const { pollIntervalMs } = contentExecutionDefaults(this.env);
    this.interval = setInterval(() => void this.drain(), pollIntervalMs);
    this.interval.unref?.();
    void this.drain();
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  isLocallyActive(tenantId: string, taskId: string): boolean {
    return [...this.active.keys()].some(key => key.startsWith(`${tenantId}\0${taskId}\0`));
  }

  async drain(): Promise<void> {
    // Pin the complete claim/execution lifecycle, including retries and callbacks,
    // so a local list cannot be followed by a remote lookup or mutation.
    if (this.options.dataAuthority && currentDataAuthority() !== this.options.dataAuthority) {
      return runWithDataAuthority(this.options.dataAuthority, () => this.drain());
    }
    if (this.draining) return;
    this.draining = true;
    try {
      const concurrency = contentExecutionDefaults(this.env).workerConcurrency;
      while (this.active.size < concurrency) {
        const claimed = await claimNextJob({
          dataStore: this.options.dataStore, workerId: this.workerId, env: this.env,
          now: this.options.now?.() ?? new Date(),
        });
        if (!claimed) break;
        const key = `${claimed.job.tenantId}\0${claimed.job.taskId}\0${claimed.job.id}`;
        const execution = this.runClaimed(claimed.job, claimed.lease)
          .catch(error => console.error('[content-execution] claimed job failed to settle', {
            jobId: claimed.job.id, error: error instanceof Error ? error.message : String(error),
          }))
          .finally(() => {
            this.active.delete(key);
            setImmediate(() => void this.drain());
          });
        this.active.set(key, execution);
      }
    } catch (error) {
      console.error('[content-execution] queue drain failed', error instanceof Error ? error.message : error);
    } finally {
      this.draining = false;
    }
  }

  private async runClaimed(job: ContentExecutionJob, initialLease: DurableOperationLease): Promise<void> {
    const defaults = contentExecutionDefaults(this.env);
    let lease = initialLease;
    let leaseOwned = true;
    const renewEveryMs = Math.max(30_000, Math.floor(defaults.leaseDurationMs / 3));
    const renewal = setInterval(() => {
      void renewDurableOperationLease({
        dataStore: this.options.dataStore, lease, leaseDurationMs: defaults.leaseDurationMs,
      }).then(async renewed => {
        lease = renewed;
        if (!await this.options.dataStore.update(CONTENT_EXECUTION_JOB_COLLECTION, job.id, {
          lease_expires_at: renewed.expiresAt, updated_at: new Date().toISOString(),
        })) throw new Error('content_execution_job_lease_update_failed');
      }).catch(error => {
        leaseOwned = false;
        console.error('[content-execution] lease renewal failed; fenced worker will stop at the next boundary', {
          jobId: job.id, error: error instanceof Error ? error.message : String(error),
        });
      });
    }, renewEveryMs);
    renewal.unref?.();
    try {
      await runWithContentExecutionContext({
        dataStore: this.options.dataStore,
        jobId: job.id,
        providerReceipts: job.providerReceipts,
        checkpoints: job.checkpoints,
        expectedWorkerId: job.workerId ?? undefined,
        expectedAttempt: job.attempt,
        executionStillOwned: () => leaseOwned,
        action: () => this.options.execute(job),
      });
      if (!leaseOwned) throw new Error('content_execution_worker_lease_lost');
      const settled = await finishSucceeded(this.options.dataStore, job, this.options.now?.() ?? new Date());
      if (settled) await this.options.onSucceeded?.(job);
    } catch (error) {
      const failed = await finishFailed({
        dataStore: this.options.dataStore, job, error,
        now: this.options.now?.() ?? new Date(), env: this.env,
      });
      if (failed.settled) {
        if (failed.decision.disposition === 'block') await this.options.onBlocked?.(job, error, failed.decision);
        else await this.options.onRetry?.(job, error, failed.decision);
      }
    } finally {
      leaseOwned = false;
      clearInterval(renewal);
      await releaseDurableOperationLease({ dataStore: this.options.dataStore, lease }).catch(() => undefined);
    }
  }
}

export async function readContentExecutionJob(
  dataStore: DataStore,
  tenantId: string,
  taskId: string,
  runId: string,
): Promise<ContentExecutionJob | null> {
  const rows = await dataStore.list<JobRow>(CONTENT_EXECUTION_JOB_COLLECTION, {
    where: { tenant_id: tenantId, task_id: taskId, run_id: runId }, perPage: 2,
  });
  if (rows.totalItems > 1 || rows.items.length > 1) throw new Error('content_execution_job_integrity_violation');
  return rows.items[0] ? jobFromRow(rows.items[0]) : null;
}

export type ContentExecutionControlAction = 'pause' | 'cancel' | 'resume' | 'retry';

/**
 * Applies customer-visible controls to the durable job itself. A running paid
 * provider call cannot always be interrupted, so pause/cancel prevents later
 * queue stages from being claimed and finish handlers preserve that decision.
 * Resuming the same job keeps its provider receipts and idempotency identity.
 */
export async function controlContentExecutionJob(input: {
  dataStore: DataStore;
  tenantId: string;
  jobId: string;
  action: ContentExecutionControlAction;
  now?: Date;
}): Promise<ContentExecutionJob> {
  const tenantId = requiredIdentity(input.tenantId, 'tenant');
  const jobId = requiredIdentity(input.jobId, 'job');
  const row = await input.dataStore.getById<JobRow>(CONTENT_EXECUTION_JOB_COLLECTION, jobId);
  if (!row) throw new Error('content_execution_job_not_found');
  const current = jobFromRow(row);
  if (current.tenantId !== tenantId) throw new Error('content_execution_job_not_found');
  const now = (input.now ?? new Date()).toISOString();
  let patch: Record<string, unknown>;
  if (input.action === 'pause') {
    if (['succeeded', 'cancelled'].includes(current.status)) throw new Error('content_execution_job_not_pauseable');
    if (current.status === 'paused') return current;
    patch = { status: 'paused', next_attempt_at: '', updated_at: now };
  } else if (input.action === 'cancel') {
    if (current.status === 'succeeded') throw new Error('content_execution_job_not_cancellable');
    if (current.status === 'cancelled') return current;
    patch = { status: 'cancelled', next_attempt_at: '', completed_at: now, updated_at: now };
  } else if (input.action === 'resume') {
    // Browser double-clicks and retried HTTP responses are expected. If the
    // first request already moved this exact durable job back into an active
    // state, the replay is a successful no-op rather than a second execution.
    if (['queued', 'running', 'retry_wait', 'reconciling'].includes(current.status)) return current;
    if (!['paused', 'cancelled'].includes(current.status)) throw new Error('content_execution_job_not_resumable');
    const reconcile = hasProviderWork(current);
    patch = {
      status: reconcile ? 'reconciling' : 'queued',
      retry_class: reconcile ? 'provider_reconciliation' : '',
      next_attempt_at: now, worker_id: '', lease_expires_at: '', completed_at: '', updated_at: now,
    };
  } else {
    if (['queued', 'running', 'retry_wait', 'reconciling'].includes(current.status)) return current;
    if (!['blocked', 'dead_letter'].includes(current.status)) throw new Error('content_execution_job_not_retryable');
    const reconcile = hasProviderWork(current);
    patch = {
      status: reconcile ? 'reconciling' : 'queued',
      retry_class: reconcile ? 'provider_reconciliation' : '',
      next_attempt_at: now, worker_id: '', lease_expires_at: '', last_error: '', completed_at: '',
      ...(reconcile ? {} : { attempt: 0, reconciliation_attempt: 0 }),
      updated_at: now,
    };
  }
  if (!await input.dataStore.update(CONTENT_EXECUTION_JOB_COLLECTION, current.id, patch)) {
    throw new Error('content_execution_job_control_failed');
  }
  const saved = await input.dataStore.getById<JobRow>(CONTENT_EXECUTION_JOB_COLLECTION, current.id);
  if (!saved) throw new Error('content_execution_job_control_readback_failed');
  return jobFromRow(saved);
}
