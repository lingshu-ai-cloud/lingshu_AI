import { stageBlockedFootageRevisionJob } from '../contentExecution/durableQueue.js';
import { createProductionGraphBridgeCheckpoint, PRODUCTION_GRAPH_BRIDGE_CHECKPOINT } from '../contentExecution/productionGraphBridge.js';
import { createSocialProductionExecutorCheckpoint } from './socialContentProductionGraph.js';
import { readSocialProductFootageRevisionPaidPlanFreeze } from './socialContentProductFootageRevisionPaidPlanFreeze.js';
import { readSocialTaskDetail } from './socialContentRecords.js';
import { socialAssetSupplyPlanIdentityHash } from './socialAssetSupplyPlanIdentity.js';
import { SocialContentWorkflowError } from './socialContentValidation.js';

type FreezeInput = Parameters<typeof readSocialProductFootageRevisionPaidPlanFreeze>[0];
const fail = (reason: string): never => {
  throw new SocialContentWorkflowError(`product_footage_revision_executor_stage_${reason}`, 409);
};

/** Real content_execution_jobs identity, staged blocked with its frozen graph
 * checkpoint. No first-frame approval, queue acknowledgement, claim or paid
 * permit is inferred here. Generic retry/resume and worker fences remain. */
export async function stageSocialProductFootageRevisionExecutor(input: FreezeInput & {
  userId: string; now?: Date;
}): Promise<{ jobId: string; inputHash: string; blockedReason: 'product_footage_revision_new_first_frame_approval_required';
  authorizesQueue: false; authorizesProvider: false; authorizesProduction: false }> {
  const { repository, guard } = input;
  const store = repository.dataStore;
  if (!store || guard.repository !== repository || guard.prepared.repository !== repository
    || guard.prepared.store !== store || !input.userId) return fail('scope_invalid');
  const read = async () => {
    const frozen = await readSocialProductFootageRevisionPaidPlanFreeze(input);
    const detail = await readSocialTaskDetail({ repository, tenantId: guard.prepared.tenantId,
      taskId: guard.prepared.taskId, ledgerRoot: guard.ledgerRoot });
    if (!detail?.assetSupplyPlan || detail.footageRevisionPlanHash !== frozen.scope.planHash
      || socialAssetSupplyPlanIdentityHash(detail.assetSupplyPlan) !== frozen.scope.planHash)
      return fail('exact_revised_plan_missing');
    const executor = createSocialProductionExecutorCheckpoint(detail, process.env);
    const payload = executor.payload;
    if (payload.executor !== 'langgraph' || payload.approvedContext?.footageRevisionPlanHash !== frozen.scope.planHash)
      return fail('graph_executor_missing');
    return { detail, executor, frozen };
  };
  const initial = await read();
  const bridge = createProductionGraphBridgeCheckpoint({
    planVersion: String(initial.executor.payload.planVersion), inputHash: initial.executor.inputHash,
    now: input.now });
  const checkpoints = { 'social.executor': initial.executor,
    [PRODUCTION_GRAPH_BRIDGE_CHECKPOINT]: bridge };
  const job = await stageBlockedFootageRevisionJob({ dataStore: store,
    tenantId: guard.prepared.tenantId, taskId: guard.prepared.taskId,
    runId: guard.revisionRunId, userId: input.userId,
    accountId: initial.detail.brief.targetAccountRef?.id,
    taskType: `social_content_${initial.detail.mode}`, checkpoints,
    assertAuthority: async () => {
      const current = await read();
      if (current.executor.inputHash !== initial.executor.inputHash
        || current.frozen.recordHash !== initial.frozen.recordHash)
        return fail('authority_changed');
    }, now: input.now });
  return { jobId: job.id, inputHash: initial.executor.inputHash,
    blockedReason: 'product_footage_revision_new_first_frame_approval_required',
    authorizesQueue: false, authorizesProvider: false, authorizesProduction: false };
}
