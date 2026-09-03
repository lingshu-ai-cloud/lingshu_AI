import { PULL_WORKER_ACTIVE_STATUSES, workerLeaseMatches, type PullWorkerLeaseState } from './digitalHumanWorkerLease.js';

export interface DigitalHumanFinalizationState extends PullWorkerLeaseState {
  cancelRequested?: boolean;
}

export interface DigitalHumanFinalizationTransfer {
  workerId: string;
  leaseId: string;
}

export type DigitalHumanFinalizationFenceFailure = 'JOB_CANCELLED' | 'JOB_TERMINAL' | 'WORKER_LEASE_MISMATCH' | null;

export function digitalHumanFinalizationFenceFailure(
  job: DigitalHumanFinalizationState,
  transfer?: DigitalHumanFinalizationTransfer,
  nowMs = Date.now(),
): DigitalHumanFinalizationFenceFailure {
  if (job.status === 'cancelled' || job.cancelRequested) return 'JOB_CANCELLED';
  if (transfer) {
    if (!PULL_WORKER_ACTIVE_STATUSES.has(job.status) || !workerLeaseMatches(job, transfer.workerId, transfer.leaseId, nowMs)) {
      return 'WORKER_LEASE_MISMATCH';
    }
    return null;
  }
  return ['review', 'completed', 'failed'].includes(job.status) ? 'JOB_TERMINAL' : null;
}
