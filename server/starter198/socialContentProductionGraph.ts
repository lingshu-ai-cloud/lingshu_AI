import type { DataStore } from '../storage/datastore.js';
import type { ContentExecutionJob } from '../contentExecution/durableQueue.js';
import { controlContentExecutionJob } from '../contentExecution/durableQueue.js';
import { assertCurrentContentExecutionActive, recordCurrentContentExecutionCheckpoint } from '../contentExecution/context.js';
import { runLangGraphProduction } from '../contentExecution/langgraphEngine.js';
import { runSocialContentAutoProduction, type SocialContentAutoProductionRuntime, type SocialGraphApprovedContext } from './socialContentProductionExecution.js';
import type { SocialAssetSupplyProviderAdapter } from './socialContentAssetSupplyExecution.js';
import { readSocialTaskDetail, requireSocialTask } from './socialContentRecords.js';
import { STARTER_COLLECTIONS, type Starter198Repository, type StarterRecord } from './repository.js';
import { socialJson, socialObject, socialRequestHash, socialText } from './socialContentValidation.js';
import { assertStudioSocialArtifactGeneration } from './socialContentOutputSupport.js';
import { writeExecutionStage } from './socialContentAutoProduction.js';
import { createSocialDeliveryPackage } from './socialContentOutputs.js';
import { graphRuntimeInventoryVisible, readCanonicalGraphRuntimeMedia } from './socialContentGraphRuntimeInventory.js';
import { withStarter198RunMutationLease } from './runMutationLease.js';
import { assertSocialContentReleaseQuality } from './socialContentReleaseQuality.js';
import { socialTaskSummary } from './socialContentRecords.js';

type Detail = NonNullable<Awaited<ReturnType<typeof readSocialTaskDetail>>>;
/** Compare business authority, excluding only identifiers derived from task projection versions. */
function graphAuthority(workflow: NonNullable<Detail['agentWorkflow']>) {
  const director = structuredClone(workflow.directorBrief) as unknown as Record<string, unknown>;
  const plan = structuredClone(workflow.executionPlan) as unknown as Record<string, unknown>;
  const review = structuredClone(workflow.executionPlanReview) as unknown as Record<string, unknown>;
  delete director.version;
  for (const key of ['version', 'directorBriefVersion']) delete plan[key];
  for (const key of ['version', 'executionPlanVersion', 'directorBriefVersion', 'reviewId']) delete review[key];
  const scenes = plan.scenes as Array<Record<string, unknown>>;
  for (const scene of scenes ?? []) {
    delete scene.idempotencyKey;
    for (const candidate of (scene.candidates ?? []) as Array<Record<string, unknown>>) {
      const provenance = candidate.provenance as Record<string, unknown> | undefined;
      if (provenance) delete provenance.inputVersion;
    }
  }
  return { director, plan, review };
}

export function socialProductionGraphInput(detail: Detail, approvedContext?: SocialGraphApprovedContext) {
  const approved = approvedContext ?? detail;
  if (!approved.agentWorkflow) throw new Error('user_input_required:production_execution_plan_missing');
  if (approvedContext && (!detail.agentWorkflow || socialRequestHash(graphAuthority(detail.agentWorkflow)) !== socialRequestHash(graphAuthority(approved.agentWorkflow))))
    throw new Error('user_input_required:graph_production_plan_changed');
  return {
    planVersion: String(approved.agentWorkflow.executionPlan.version),
    inputHash: socialRequestHash({ brief: detail.brief, executionPlan: approved.agentWorkflow.executionPlan,
      executionPlanReview: approved.agentWorkflow.executionPlanReview,
      directorBrief: approved.agentWorkflow.directorBrief, sources: detail.sources,
      ...((approved as SocialGraphApprovedContext).revisionPlanHash ? { revisionPlanHash: (approved as SocialGraphApprovedContext).revisionPlanHash } : {}) }),
  };
}

/** Self-generated runtime inventory cannot rewrite the admitted business plan.
 * Previously admitted sources remain visible and retain all normal validation. */
export async function readSocialProductionGraphDetail(input: { repository: Starter198Repository; tenantId: string; taskId: string }, approvedContext: SocialGraphApprovedContext) {
  if (approvedContext.revisionPlanHash) {
    const row = await requireSocialTask(input), marker = socialObject(socialObject(socialJson(row.brief))?._productionRevision);
    const { planHash, preparedBy: _actor, preparedAt: _time, ...immutable } = marker ?? {};
    if (planHash !== approvedContext.revisionPlanHash || socialRequestHash(immutable) !== planHash)
      throw new Error('user_input_required:graph_revision_plan_changed');
  }
  const admittedRefs = new Set<string>([
    ...(approvedContext.agentWorkflow?.executionPlan.scenes.flatMap(scene => scene.candidates.map(candidate => candidate.sourceRef).filter(Boolean)) ?? []),
    ...(approvedContext.assetSupplyPlan?.inventoryAudit?.records.map(record => record.id) ?? []),
  ].filter((ref): ref is string => typeof ref === 'string' && Boolean(ref)));
  const task = await requireSocialTask(input);
  const canonical = input.repository.dataStore && task.run_id ? await readCanonicalGraphRuntimeMedia({dataStore:input.repository.dataStore,tenantId:input.tenantId,taskId:input.taskId,runId:String(task.run_id),approvedContext}) : [];
  const library = input.repository.materialLibrary;
  const repository: Starter198Repository = library ? { ...input.repository, materialLibrary: async (...args) => {
    const result = await library(...args);
    return { ...result, items: result.items.filter(item => graphRuntimeInventoryVisible(item,{tenantId:input.tenantId,taskId:input.taskId,admittedRefs,canonical})) };
  } } : input.repository;
  return readSocialTaskDetail({ ...input, repository });
}

export function createSocialProductionExecutorCheckpoint(detail: Detail, env: NodeJS.ProcessEnv = process.env, revisionPlanHash?: string) {
  if (revisionPlanHash && !/^[a-f0-9]{64}$/.test(revisionPlanHash)) throw new Error('user_input_required:graph_revision_plan_changed');
  const graphEnabled = env.SOCIAL_CONTENT_EXECUTOR === 'langgraph' && detail.brief.productionApproach !== 'shooting_plan';
  const identity = graphEnabled ? socialProductionGraphInput(detail, revisionPlanHash ? { ...detail, revisionPlanHash } : undefined) : { planVersion: 'legacy', inputHash: 'legacy' };
  const approvedContext: SocialGraphApprovedContext | null = graphEnabled ? structuredClone({
    version: detail.version, agentWorkflow: detail.agentWorkflow, assetSupplyPlan: detail.assetSupplyPlan, ...(revisionPlanHash ? { revisionPlanHash } : {}) }) : null;
  if (approvedContext?.agentWorkflow) {
    approvedContext.agentWorkflow.productionResult = null;
    approvedContext.agentWorkflow.replicationEvaluation = null;
  }
  return { version: '1', inputHash: identity.inputHash, updatedAt: new Date().toISOString(),
    payload: { executor: graphEnabled ? 'langgraph' : 'legacy', ...identity, ...(approvedContext ? { approvedContext } : {}) } };
}

export function socialProductionExecutor(job: ContentExecutionJob, rawCheckpoints?: unknown): 'legacy' | 'langgraph' {
  const binding = job.checkpoints['social.executor'];
  const raw = socialObject(socialJson(rawCheckpoints));
  if (!binding) {
    if (Object.hasOwn(raw ?? {}, 'social.executor') || job.checkpoints['langgraph.v1'] || Object.hasOwn(raw ?? {}, 'langgraph.v1'))
      throw new Error('user_input_required:production_executor_binding_invalid');
    return 'legacy';
  }
  const payload = socialObject(binding.payload);
  if (binding.version !== '1' || !payload || !['legacy', 'langgraph'].includes(String(payload.executor))
    || !socialText(payload.planVersion) || binding.inputHash !== payload.inputHash
    || payload.executor === 'langgraph' && !/^[a-f0-9]{64}$/.test(String(payload.inputHash))) throw new Error('user_input_required:production_executor_binding_invalid');
  return payload.executor as 'legacy' | 'langgraph';
}

async function productionArtifact(repository: Starter198Repository, job: ContentExecutionJob) {
  const rows = await repository.list(STARTER_COLLECTIONS.socialContentArtifacts, job.tenantId, { where: { task_id: job.taskId }, perPage: 500 });
  const candidates = rows.items.filter(row => {
    const content = socialObject(socialJson(row.content));
    const source = socialObject(content?.productionWorkspaceSource);
    return row.origin === 'agent' && row.artifact_kind === 'short_video' && source?.runId === job.runId
      && !['superseded', 'changes_requested', 'rejected'].includes(String(row.status));
  });
  if (candidates.length !== 1) throw new Error('user_input_required:graph_production_artifact_not_unique');
  return candidates[0]!;
}

function artifactEvidence(row: StarterRecord) {
  return { artifactId: socialText(row.artifact_id), contentHash: socialRequestHash(socialJson(row.content)), version: socialText(row.version) };
}

/** Read the canonical business decision and its completed operation. A graph
 * checkpoint, client approval flag or an unrelated approved asset grants nothing. */
export async function loadSocialProductionGraphApproval(repository: Starter198Repository, job: ContentExecutionJob) {
  const artifact = await productionArtifact(repository, job);
  if (artifact.status !== 'approved') return null;
  const checkpoint = job.checkpoints['social.graph_review'];
  const expected = socialObject(checkpoint?.payload);
  const evidence = artifactEvidence(artifact);
  if (!expected || expected.artifactId !== evidence.artifactId || expected.contentHash !== evidence.contentHash
    || expected.runId !== job.runId) throw new Error('user_input_required:graph_review_subject_changed');
  if (!Number.isSafeInteger(Number(expected.version)) || Number(evidence.version) !== Number(expected.version) + 1)
    throw new Error('user_input_required:graph_review_version_changed');
  const receiptRef = socialText(artifact.last_operation_id);
  if (!receiptRef) throw new Error('user_input_required:graph_review_receipt_missing');
  const receipts = await repository.list(STARTER_COLLECTIONS.socialContentOperations, job.tenantId,
    { where: { operation_id: receiptRef }, perPage: 2 });
  const receipt = receipts.items[0];
  if (receipts.totalItems !== 1 || !receipt || receipt.status !== 'succeeded'
    || !['decide_social_content_artifact', 'decide_social_content_artifact_batch'].includes(String(receipt.operation))
    || receipt.target_id !== job.taskId)
    throw new Error('user_input_required:graph_review_receipt_invalid');
  await assertStudioSocialArtifactGeneration(job.tenantId, socialText(artifact.artifact_kind), artifact.content);
  const content = socialJson(artifact.content);
  if (socialObject(content)?.workflowSchema === 'social-content.auto-production.v3') {
    const task = await requireSocialTask({ repository, tenantId: job.tenantId, taskId: job.taskId });
    assertSocialContentReleaseQuality({ brief: socialTaskSummary(task).brief, content, mode: 'human' });
  }
  return { approved: true, receiptRef, subjectVersion: evidence.version, contentHash: evidence.contentHash };
}

export async function executeSocialProductionGraph(input: { repository: Starter198Repository; dataStore: DataStore; job: ContentExecutionJob;
  runtime?: SocialContentAutoProductionRuntime; assetSupplyAdapters?: SocialAssetSupplyProviderAdapter[]; assetSupplyRecoveryOnly?: boolean;
  materialEvidencePorts?: Parameters<typeof runSocialContentAutoProduction>[0]['materialEvidencePorts']; }) {
  const { repository, dataStore, job } = input;
  const binding = socialObject(job.checkpoints['social.executor']?.payload);
  const approvedContext = socialObject(binding?.approvedContext) as unknown as SocialGraphApprovedContext | null;
  if (!approvedContext?.agentWorkflow || !approvedContext.version) throw new Error('user_input_required:graph_approved_context_missing');
  const detail = await readSocialProductionGraphDetail({ repository, tenantId: job.tenantId, taskId: job.taskId }, approvedContext);
  if (!detail) throw new Error('user_input_required:graph_task_missing');
  const current = socialProductionGraphInput(detail, approvedContext);
  if (binding?.inputHash !== current.inputHash || binding?.planVersion !== current.planVersion)
    throw new Error('user_input_required:graph_production_plan_changed');
  const identity = { tenantId: job.tenantId, taskId: job.taskId, runId: job.runId, jobId: job.id,
    ...current, graphVersion: 'content-production.v1' as const };
  const refreshedJob = async () => {
    const { readContentExecutionJob } = await import('../contentExecution/durableQueue.js');
    const actual = await readContentExecutionJob(dataStore, job.tenantId, job.taskId, job.runId);
    if (!actual || actual.id !== job.id) throw new Error('graph_job_scope_changed');
    return actual;
  };
  const approval = () => refreshedJob().then(actual => loadSocialProductionGraphApproval(repository, actual));
  const resume = job.checkpoints['social.graph_review'] ? await approval() : null;
  const phase = async (graphPhase: 'assets' | 'render' | 'quality') => {
    await assertCurrentContentExecutionActive();
    const latest = await readSocialProductionGraphDetail({ repository, tenantId: job.tenantId, taskId: job.taskId }, approvedContext);
    if (!latest || socialProductionGraphInput(latest, approvedContext).inputHash !== current.inputHash) throw new Error('user_input_required:graph_production_plan_changed');
    await runSocialContentAutoProduction({ repository, tenantId: job.tenantId, userId: job.userId,
      taskId: job.taskId, runId: job.runId, graphPhase, runtime: input.runtime,
      assetSupplyAdapters: input.assetSupplyAdapters, assetSupplyRecoveryOnly: input.assetSupplyRecoveryOnly, materialEvidencePorts: input.materialEvidencePorts, graphApprovedContext: approvedContext });
    if (graphPhase === 'quality') {
      const artifact = await productionArtifact(repository, job);
      const evidence = artifactEvidence(artifact);
      await recordCurrentContentExecutionCheckpoint({ stage: 'social.graph_review', version: '1', inputHash: current.inputHash,
        payload: { ...evidence, runId: job.runId } });
      return { artifactRefs: [evidence.artifactId], inputHash: current.inputHash, metadata: { contentHash: evidence.contentHash } };
    }
    const actual = await refreshedJob();
    const checkpoint = actual.checkpoints[graphPhase === 'assets' ? 'social.asset_supply' : 'social.graph_render'];
    return { artifactRefs: [], inputHash: checkpoint?.inputHash || current.inputHash,
      metadata: { checkpointStage: graphPhase === 'assets' ? 'social.asset_supply' : 'social.graph_render' } };
  };
  const result = await runLangGraphProduction({ identity, dataStore, assertActive: assertCurrentContentExecutionActive,
    phases: { assets: () => phase('assets'), render: () => phase('render'), quality: () => phase('quality'),
      delivery: async () => {
        const accepted = await approval();
        if (!accepted) throw new Error('user_input_required:graph_delivery_review_required');
        const artifact = await productionArtifact(repository, job);
        const task = await readSocialProductionGraphDetail({ repository, tenantId: job.tenantId, taskId: job.taskId }, approvedContext);
        if (!task) throw new Error('graph_task_missing');
        if (socialProductionGraphInput(task, approvedContext).inputHash !== current.inputHash)
          throw new Error('user_input_required:graph_production_plan_changed');
        const packaged = await createSocialDeliveryPackage({ repository, tenantId: job.tenantId, userId: job.userId,
          taskId: job.taskId, idempotencyKey: `graph-delivery:${job.id}:${accepted.contentHash}`,
          backendFilePort: input.runtime?.backendFilePort,
          value: { expectedTaskVersion: task.version, artifactIds: [socialText(artifact.artifact_id)] } });
        await writeExecutionStage({ repository, tenantId: job.tenantId, runId: job.runId, stage: 'delivery_prepared',
          message: '已核对人工审核回执，成片可以进入现有交付打包流程。',
          extra: { artifactId: socialText(artifact.artifact_id), approvalReceipt: accepted.receiptRef, externalPublishPerformed: false } });
        return { artifactRefs: [socialText(artifact.artifact_id), packaged.deliveryPackage.packageId], inputHash: current.inputHash,
          metadata: { artifactId: socialText(artifact.artifact_id), packageId: packaged.deliveryPackage.packageId,
            approvalReceipt: accepted.receiptRef, externalPublishPerformed: false } };
      } },
    review: { loadApproval: approval, verifyResume: async proposed => {
      const accepted = await approval();
      return !!accepted && socialRequestHash(accepted) === socialRequestHash(proposed);
    } }, ...(resume ? { resume } : {}) });
  if (result.status === 'waiting_review') {
    await assertCurrentContentExecutionActive();
    const actual = await refreshedJob();
    const expected = socialObject(actual.checkpoints['social.graph_review']?.payload);
    if (!expected) throw new Error('graph_review_subject_missing');
    await recordCurrentContentExecutionCheckpoint({ stage: 'social.graph_review', version: '1', inputHash: current.inputHash,
      payload: { ...expected, waitingReview: true } });
    await controlContentExecutionJob({ dataStore, tenantId: job.tenantId, jobId: job.id, action: 'pause', pauseOrigin: 'workflow_review' });
    await withStarter198RunMutationLease({ dataStore, tenantId: job.tenantId, runId: job.runId, action: async () => {
      const run = await repository.get(STARTER_COLLECTIONS.runs, job.tenantId, job.runId);
      if (run && ['running', 'waiting_external', 'waiting_approval', 'planning'].includes(String(run.status)))
        await repository.update(STARTER_COLLECTIONS.runs, job.tenantId, run.id,
          { status: 'waiting_human', current_controller: 'human', pause_reason: 'langgraph_artifact_review_required' });
    } });
  } else {
    const delivery = result.state.evidence.delivery;
    const metadata = socialObject(delivery?.metadata);
    if (!metadata?.artifactId || !metadata.packageId || !result.state.approval) throw new Error('graph_completion_business_evidence_missing');
    await recordCurrentContentExecutionCheckpoint({ stage: 'social.graph_completion', version: '1', inputHash: current.inputHash,
      payload: { ...identity, approval: result.state.approval, artifactIds: [metadata.artifactId], packageIds: [metadata.packageId], externalPublishPerformed: false } });
  }
  return result;
}

export async function resumeApprovedSocialProductionGraph(input: {
  repository: Starter198Repository; tenantId: string; userId: string; taskId: string; artifactId: string;
}): Promise<string | null> {
  const dataStore = input.repository.dataStore;
  if (!dataStore) return null;
  const { listContentExecutionJobs } = await import('../contentExecution/durableQueue.js');
  const jobs = await listContentExecutionJobs(dataStore, input.tenantId);
  const candidates = jobs.filter(job => job.taskId === input.taskId && socialProductionExecutor(job) === 'langgraph'
    && job.status === 'paused' && !!job.checkpoints['social.graph_review']);
  if (candidates.length !== 1) return null;
  const job = candidates[0]!;
  const expected = socialObject(job.checkpoints['social.graph_review']?.payload);
  const pause = socialObject(job.checkpoints['runtime.pause']?.payload);
  if (pause?.origin !== 'workflow_review' || expected?.waitingReview !== true || expected.artifactId !== input.artifactId
    || !await loadSocialProductionGraphApproval(input.repository, job)) return null;
  const binding = socialObject(job.checkpoints['social.executor']?.payload);
  const approvedContext = socialObject(binding?.approvedContext) as unknown as SocialGraphApprovedContext | undefined;
  const detail = approvedContext?.agentWorkflow ? await readSocialProductionGraphDetail(input, approvedContext) : null;
  if (!detail || !approvedContext?.agentWorkflow || socialProductionGraphInput(detail, approvedContext).inputHash !== binding?.inputHash) throw new Error('user_input_required:graph_production_plan_changed');
  if (job.workerId !== null || job.leaseExpiresAt !== null) return null;
  const resumed = await withStarter198RunMutationLease({ dataStore, tenantId: job.tenantId, runId: job.runId, action: async () => {
    const run = await input.repository.get(STARTER_COLLECTIONS.runs, job.tenantId, job.runId);
    if (!run || run.status !== 'waiting_human' || run.pause_reason !== 'langgraph_artifact_review_required') return false;
    await controlContentExecutionJob({ dataStore, tenantId: job.tenantId, jobId: job.id, action: 'resume' });
    if (run?.status === 'waiting_human' && run.pause_reason === 'langgraph_artifact_review_required')
      await input.repository.update(STARTER_COLLECTIONS.runs, job.tenantId, run.id,
        { status: 'waiting_external', current_controller: 'agent', pause_reason: null });
    return true;
  } });
  return resumed ? job.id : null;
}
