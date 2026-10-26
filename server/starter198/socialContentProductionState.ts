import type { ContentExecutionJob } from '../contentExecution/durableQueue.js';
import { readContentExecutionJob } from '../contentExecution/durableQueue.js';
import { assertCurrentContentExecutionActive } from '../contentExecution/context.js';
import type { SocialGraphApprovedContext } from './socialContentProductionExecution.js';
import { executeSocialContentMutation } from './socialContentMutation.js';
import { reconcileSocialContentTask } from './socialContentProjection.js';
import { requireSocialTask } from './socialContentRecords.js';
import type { Starter198Repository, StarterRecord } from './repository.js';
import { readGraphContextSnapshot } from './socialContentGraphContextSnapshots.js';
import { socialObject, socialRequestHash, socialText } from './socialContentValidation.js';

type Identity = { tenantId: string; taskId: string; runId: string; jobId: string; userId: string;
  expectedTaskVersion: string; frozenInputHash: string; graphInputHash: string; planVersion: string; approvedContext: SocialGraphApprovedContext };
const fail = (reason: string): never => { throw Error('user_input_required:production_state_' + reason); };

/** A queue receipt alone cannot authorize production: bind the current order,
 * active worker, immutable executor and the exact approved director review. */
export function assertSocialProductionStateAdmission(input: Identity, task: StarterRecord, job: ContentExecutionJob) {
  if (task.tenant_id !== input.tenantId || task.task_id !== input.taskId || task.run_id !== input.runId
    || socialText(task.version) !== input.expectedTaskVersion) fail('task_identity_changed');
  if (['paused', 'cancelling', 'cancelled', 'needs_input', 'draft'].includes(socialText(task.status))) fail('task_not_executing');
  if (job.id !== input.jobId || job.tenantId !== input.tenantId || job.taskId !== input.taskId || job.runId !== input.runId
    || !job.taskType.startsWith('social_content_') || !['queued','running','retry_wait','reconciling'].includes(job.status)) fail('job_not_admitted');
  const binding = job.checkpoints['social.executor'], payload = socialObject(binding?.payload);
  if (binding?.version !== '1' || payload?.executor !== 'langgraph' || binding.inputHash !== input.frozenInputHash
    || payload.inputHash !== input.frozenInputHash || payload.planVersion !== input.planVersion) fail('executor_changed');
  const admitted = readGraphContextSnapshot(payload), corrected = readGraphContextSnapshot(socialObject(job.checkpoints['social.corrected_executor']?.payload));
  if (![admitted, corrected].some(context => context && socialRequestHash(context) === socialRequestHash(input.approvedContext))) fail('approved_context_changed');
  const workflow = input.approvedContext.agentWorkflow, plan = workflow?.executionPlan, review = workflow?.executionPlanReview, director = workflow?.directorBrief;
  if (!plan || !review || !director || plan.status !== 'approved' || !review.approved || review.executionPlanId !== plan.executionPlanId
    || review.executionPlanVersion !== plan.version || review.directorBriefId !== director.directorBriefId
    || review.directorBriefVersion !== director.version) fail('approved_review_required');
}

/** Repair lifecycle projection on the original mutation/reconcile path after
 * graph admission, including legacy runs initially left at plan_review. */
export async function reconcileAdmittedSocialProductionState(input: Identity & { repository: Starter198Repository }) {
  const store = input.repository.dataStore; if (!store) return fail('storage_missing');
  const identity = { tenantId: input.tenantId, taskId: input.taskId, runId: input.runId, jobId: input.jobId,
    frozenInputHash: input.frozenInputHash, graphInputHash: input.graphInputHash, planVersion: input.planVersion };
  const project = async (operationId: string) => {
    await assertCurrentContentExecutionActive();
    const task = await requireSocialTask(input), job = await readContentExecutionJob(store,input.tenantId,input.taskId,input.runId);
    if (!job) return fail('job_missing');
    assertSocialProductionStateAdmission(input, task, job);
    const graph = await import('./socialContentProductionGraph.js');
    const detail = await graph.readSocialProductionGraphDetail(input, input.approvedContext);
    if (!detail || graph.socialProductionGraphInput(detail,input.approvedContext).inputHash !== input.graphInputHash) fail('business_authority_changed');
    await assertCurrentContentExecutionActive();
    const updated = await reconcileSocialContentTask({ ...input, operationId, preferredStatus: 'producing' });
    return { status: socialText(updated.status), version: socialText(updated.version) };
  };
  return (await executeSocialContentMutation({ ...input,
    operation: 'reconcile_social_production_state', targetId: input.taskId,
    idempotencyKey: `production-state:${input.jobId}:${input.frozenInputHash}:${input.graphInputHash}`,
    requestHash: socialRequestHash(identity), action: project, replay: project })).value;
}
