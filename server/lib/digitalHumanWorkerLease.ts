import { randomUUID } from 'node:crypto';

export type PullWorkerLeaseStatus = 'queued' | 'submitting' | 'processing' | 'quality_check' | 'review' | 'completed' | 'failed' | 'cancelled';

export interface PullWorkerLeaseState {
  status: PullWorkerLeaseStatus;
  workerId?: string;
  workerLeaseId?: string;
  workerLeaseUntil?: string;
  workerAttemptCount?: number;
}

export const PULL_WORKER_ACTIVE_STATUSES = new Set<PullWorkerLeaseStatus>([
  'submitting',
  'processing',
  'quality_check',
]);

export function createWorkerLeaseId(): string {
  return randomUUID();
}

export function workerAttemptCount(job: PullWorkerLeaseState): number {
  const attempts = Number(job.workerAttemptCount || 0);
  return Number.isFinite(attempts) && attempts > 0 ? Math.floor(attempts) : 0;
}

export function workerLeaseExpired(job: PullWorkerLeaseState, nowMs = Date.now()): boolean {
  if (!PULL_WORKER_ACTIVE_STATUSES.has(job.status)) return false;
  const leaseUntil = Date.parse(String(job.workerLeaseUntil || ''));
  return !Number.isFinite(leaseUntil) || leaseUntil <= nowMs;
}

export function workerJobClaimable(job: PullWorkerLeaseState, nowMs: number, maxAttempts: number): boolean {
  if (workerAttemptCount(job) >= Math.max(1, maxAttempts)) return false;
  return job.status === 'queued' || workerLeaseExpired(job, nowMs);
}

export type WorkerLeaseRecoveryAction = 'requeue' | 'fail' | null;

export function workerLeaseRecoveryAction(
  job: PullWorkerLeaseState,
  nowMs: number,
  maxAttempts: number,
): WorkerLeaseRecoveryAction {
  const attemptsExhausted = workerAttemptCount(job) >= Math.max(1, maxAttempts);
  if (job.status === 'queued') return attemptsExhausted ? 'fail' : null;
  if (!workerLeaseExpired(job, nowMs)) return null;
  return attemptsExhausted ? 'fail' : 'requeue';
}

export function workerLeaseMatches(job: PullWorkerLeaseState, workerId: string, leaseId: string, nowMs = Date.now()): boolean {
  const leaseUntil = Date.parse(String(job.workerLeaseUntil || ''));
  return Boolean(
    workerId
    && leaseId
    && job.workerId === workerId
    && job.workerLeaseId === leaseId
    && Number.isFinite(leaseUntil)
    && leaseUntil > nowMs
  );
}
