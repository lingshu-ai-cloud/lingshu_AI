import { randomUUID } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import { acquireDurableOperationLease, releaseDurableOperationLease } from '../runtime/durableLease.js';
import { atomicContentExecutionJobUpdate } from '../contentExecution/durableQueueAtomic.js';
import { readSocialImageTask } from './socialImageTask.js';
import { imageExecutionInputHash } from './socialImageExecutionQueue.js';

/** Operator review of a specific, definitive post-response validation error.
 * A transport timeout or any other unknown result can never use this recovery.
 * The legacy checkpoint is retained because its original response was not saved.
 */
export async function reconcileImagePlanningValidation(input: {
  store: DataStore; tenantId: string; jobId: string; taskId: string;
  expectedCheckpointAt: string; approvedBy: string; reason: string;
}) {
  if (!input.approvedBy.trim() || !input.reason.trim()) throw Error('social_image_planning_review_authorization_required');
  const lease = await acquireDurableOperationLease({ dataStore: input.store, tenantId: input.tenantId,
    scope: 'content_execution_job', subjectId: input.jobId, ownerId: randomUUID(), leaseDurationMs: 30_000 });
  if (!lease) throw Error('social_image_planning_review_busy');
  try {
    const job = await input.store.getById<Record<string, any>>('content_execution_jobs', input.jobId);
    const task = await readSocialImageTask(input.store, input.tenantId, input.taskId);
    const checkpoint = job?.checkpoints?.['image.planning'];
    const confirmed = job?.checkpoints?.['image.confirmed'];
    if (!job || !task || job.tenant_id !== input.tenantId || job.run_id !== input.taskId
      || job.task_id !== task.productionRuntime?.binding?.contentTaskId || job.task_type !== 'social_image_replication'
      || job.status !== 'blocked' || job.worker_id || job.lease_expires_at
      || task.outputs.length || task.generationJobs.length || (job.provider_receipts || []).length
      || checkpoint?.updatedAt !== input.expectedCheckpointAt || checkpoint?.payload?.state !== 'outcome_unknown'
      || checkpoint?.payload?.code !== 'social_image_buyer_copy_evidence_invalid'
      || checkpoint.inputHash !== imageExecutionInputHash(task) || confirmed?.inputHash !== checkpoint.inputHash
      || job.checkpoints['image.planning.validation_review']) throw Error('social_image_planning_review_scope_changed');
    const now = new Date().toISOString();
    const checkpoints = { ...job.checkpoints,
      'image.planning.validation_review': { ...checkpoint, payload: { original: checkpoint,
        approvedBy: input.approvedBy, reason: input.reason, reviewedAt: now,
        finding: 'Known post-response copy validation rejection; legacy response text unavailable; no image submitted.' }, updatedAt: now },
      'image.planning': { ...checkpoint, payload: { state: 'validation_rejected_reconciled',
        code: checkpoint.payload.code, approvedBy: input.approvedBy, reason: input.reason }, updatedAt: now },
    };
    const changed = await atomicContentExecutionJobUpdate(input.store, input.jobId, { status: 'blocked',
      updated_at: job.updated_at, attempt: job.attempt, worker_id: '', lease_expires_at: '', checkpoints: job.checkpoints },
    { checkpoints, updated_at: now }, 'social_image_planning_review_atomic_fence_required');
    if (!changed) throw Error('social_image_planning_review_scope_changed');
  } finally { await releaseDurableOperationLease({ dataStore: input.store, lease }); }
}
