import { z } from 'zod';
import type { Starter198Repository } from './repository.js';
import { requireSocialTask } from './socialContentRecords.js';
import { SocialContentWorkflowError, socialRequestHash, socialText } from './socialContentValidation.js';
import { readContentExecutionJob, controlContentExecutionJob } from '../contentExecution/durableQueue.js';
import { amendCanonicalUnsubmittedVoiceRoute } from './socialContentVoiceRouteControl.js';

const recoveryIdentity = z.object({
  jobId: z.string().trim().min(1).max(200),
  runId: z.string().trim().min(1).max(200),
  expectedVersion: z.string().trim().min(1).max(200),
});
export const executionRecoveryInput = z.union([recoveryIdentity.extend({
  action: z.literal('retry_failed_native_voice').optional(),
  failedOperationId: z.string().regex(/^paid-plan:[a-f0-9]{64}$/),
}).strict(), recoveryIdentity.extend({ action: z.literal('resume_existing_execution') }).strict()]);
type RecoveryCommand = z.infer<typeof executionRecoveryInput>;
type RecoveryPorts = {
  amend?: typeof amendCanonicalUnsubmittedVoiceRoute;
  control?: typeof controlContentExecutionJob;
};

/** Recover the original order, never create a new content task or accept a
 * caller supplied price/person/credit limit. The domain control re-verifies
 * the failed supplier receipt while holding the original control lease. */
export async function recoverSocialContentExecution(input: {
  repository: Starter198Repository; tenantId: string; userId: string;
  taskId: string; command: RecoveryCommand; idempotencyKey: string;
}, ports: RecoveryPorts = {}) {
  const store = input.repository.dataStore;
  if (!store) throw new SocialContentWorkflowError('content_execution_storage_unavailable', 503);
  const task = await requireSocialTask(input);
  const command = executionRecoveryInput.parse(input.command);
  if (socialText(task.version) !== command.expectedVersion || task.run_id !== command.runId)
    throw new SocialContentWorkflowError('content_execution_recovery_task_changed', 409);
  const job = await readContentExecutionJob(store, input.tenantId, input.taskId, command.runId);
  if (!job || job.id !== command.jobId)
    throw new SocialContentWorkflowError('content_execution_recovery_job_changed', 409);
  if (command.action === 'resume_existing_execution') {
    const active = job.checkpoints['social.voice_route_amendment']?.payload as
      { newIntent?: { operationId?: string }; recordHash?: string; retry?: { attempt?: number } } | undefined;
    if (['queued', 'running', 'retry_wait', 'reconciling'].includes(job.status))
      return { taskId: input.taskId, runId: command.runId, jobId: job.id,
        status: job.status, operationId: active?.newIntent?.operationId ?? null,
        amendmentHash: active?.recordHash ?? null, attempt: active?.retry?.attempt ?? 0 };
    const providerWork=job.providerReceipts.some(receipt=>['submitting','accepted','unknown'].includes(receipt.state));
    if (!['blocked', 'paused'].includes(job.status) || job.workerId || job.leaseExpiresAt
      || !providerWork && (!job.providerReceipts.some(receipt => receipt.state === 'completed')
        || job.providerReceipts.some(receipt => !['completed', 'failed'].includes(receipt.state))
        || ['submitting', 'accepted', 'unknown'].includes(job.providerState)
        || job.providerReceipts.some(receipt => receipt.requestId === active?.newIntent?.operationId && receipt.state === 'failed')))
      throw new SocialContentWorkflowError('content_execution_recovery_original_receipt_required', 409);
    const resumed = await (ports.control || controlContentExecutionJob)({ dataStore: store,
      tenantId: input.tenantId, jobId: job.id, action: job.status === 'paused' ? 'resume' : 'retry' });
    return { taskId: input.taskId, runId: command.runId, jobId: resumed.id,
      status: resumed.status, operationId: active?.newIntent?.operationId ?? null,
      amendmentHash: active?.recordHash ?? null, attempt: active?.retry?.attempt ?? 0 };
  }
  const authorizationRef = 'content-execution-recovery:' + socialRequestHash({
    tenantId: input.tenantId, userId: input.userId, taskId: input.taskId,
    command, idempotencyKey: input.idempotencyKey,
  });
  const amendment = await (ports.amend || amendCanonicalUnsubmittedVoiceRoute)({
    store, tenantId: input.tenantId, taskId: input.taskId, runId: command.runId,
    jobId: command.jobId, authorizationRef, mode: 'native_video', retryFailed: true,
    expectedFailedOperationId: command.failedOperationId,
  });
  const resumed = await (ports.control || controlContentExecutionJob)({
    dataStore: store, tenantId: input.tenantId, jobId: command.jobId, action: 'retry',
  });
  return { taskId: input.taskId, runId: command.runId, jobId: resumed.id,
    status: resumed.status, operationId: amendment.newIntent.operationId,
    amendmentHash: amendment.recordHash, attempt: amendment.retry?.attempt ?? 0 };
}
