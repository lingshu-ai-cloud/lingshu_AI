import { randomUUID } from 'node:crypto';
import type { Starter198Repository } from './repository.js';
import type { Record_ } from '../storage/datastore.js';
import { acquireDurableOperationLease, assertDurableOperationLease, releaseDurableOperationLease } from '../runtime/durableLease.js';
import { controlContentExecutionJob, readContentExecutionJob } from '../contentExecution/durableQueue.js';
import { readSocialSceneReworkStatus } from './socialContentSceneReworkRead.js';
import { createSocialSceneReworkSupplyPorts } from './socialContentSceneReworkSupplyPorts.js';
import { createSocialSceneReworkCostPolicyService } from './socialContentSceneReworkCostPolicy.js';
import { createSocialSceneReworkService } from './socialContentSceneReworkService.js';

const fail = (code: string): never => { throw new Error(code); };

/** Explicitly continues one already-authorized repair job. It creates no new run or supplier request. */
export async function resumeSocialSceneRework(input: {
  repository: Starter198Repository; tenantId: string; actorUserId: string; taskId: string; operationId: string;
  expectedJobId: string; expectedPolicyHash?: string;
}) {
  const { repository } = input;
  const store = repository.dataStore;
  if (!store) return fail('scene_rework_persistent_store_required');
  const status = await readSocialSceneReworkStatus(input);
  if (status.jobId !== input.expectedJobId || status.runStatus !== 'running') return fail('scene_rework_resume_scope_invalid');
  const lease = await acquireDurableOperationLease({ dataStore: store, tenantId: input.tenantId,
    scope: 'social_scene_rework_control', subjectId: status.jobId, ownerId: randomUUID() });
  if (!lease) return fail('scene_rework_resume_busy');
  try {
    const job = await readContentExecutionJob(store, input.tenantId, input.taskId, status.executionRunId);
    if (!job || job.id !== input.expectedJobId || job.userId !== input.actorUserId
      || job.taskType !== `social_scene_rework:${input.operationId}` || !['blocked', 'dead_letter', 'paused'].includes(job.status)) {
      return fail('scene_rework_job_not_resumable');
    }
    const active = await store.list<Record_>('durable_operation_leases', { where: { tenant_id: input.tenantId,
      lease_scope: 'content_execution_job', subject_id: job.id }, perPage: 2 });
    if (active.totalItems !== active.items.length || active.items.length > 1
      || active.items.some(row => !Number.isFinite(Date.parse(String(row.expires_at))) || Date.parse(String(row.expires_at)) > Date.now())) {
      return fail('scene_rework_worker_lease_active');
    }
    const context = await createSocialSceneReworkService(repository).readForJob({ tenantId: input.tenantId,
      taskId: input.taskId, runId: job.runId, actorUserId: input.actorUserId, operationId: input.operationId });
    const providerWork = job.providerReceipts.some(receipt => ['submitting', 'accepted', 'unknown', 'completed'].includes(receipt.state));
    if (!providerWork) {
      const ports = createSocialSceneReworkSupplyPorts({ repository, job });
      const evidence = await ports.readBudgetEvidence();
      if (!evidence.localOnly) {
        const policy = await createSocialSceneReworkCostPolicyService(repository).requireConfirmed({ tenantId: input.tenantId,
          taskId: input.taskId, runId: job.runId, operationId: input.operationId, actorUserId: input.actorUserId });
        if (!input.expectedPolicyHash || input.expectedPolicyHash !== policy.recordHash) return fail('scene_rework_cost_policy_version_conflict');
      }
      await ports.assertBudget(context.intent);
    }
    await assertDurableOperationLease({ dataStore: store, lease });
    await controlContentExecutionJob({ dataStore: store, tenantId: input.tenantId, jobId: job.id,
      action: job.status === 'paused' ? 'resume' : 'retry' });
    return await readSocialSceneReworkStatus(input);
  } finally { await releaseDurableOperationLease({ dataStore: store, lease }); }
}
