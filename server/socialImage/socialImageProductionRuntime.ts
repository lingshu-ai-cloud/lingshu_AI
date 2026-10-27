import { createHash, randomUUID } from 'node:crypto';
import {
  SOCIAL_IMAGE_PRODUCTION_NODES,
  socialImageHookFactorIssues,
  type SocialImageProductionBinding,
  type SocialImageProductionEvent,
  type SocialImageProductionNodeId,
  type SocialImageProductionNodeState,
  type SocialImageProductionNodeStatus,
  type SocialImageProductionRuntime,
  type SocialImageProductionSnapshot,
} from '../../shared/contracts/socialImageProduction.js';
import {
  socialImageCurrentOutputs,
  socialImageOutputHardChecksPassed,
  socialImageReviewOutputs,
  type SocialImageCreationTask,
  type SocialImageOutputNode,
} from '../../shared/contracts/socialImageCreation.js';
import { resolveSocialImageReviewSet, socialImageDirectorReviewMatchesSet } from './socialImageReviewSet.js';

const completed = (nodeId: SocialImageProductionNodeId): SocialImageProductionNodeState => ({
  nodeId, status: 'completed', attempt: 1, blockingReasons: [],
});
const waiting = (nodeId: SocialImageProductionNodeId): SocialImageProductionNodeState => ({
  nodeId, status: 'waiting', attempt: 0, blockingReasons: [],
});

function currentArtifactRefs(task: SocialImageCreationTask) {
  return socialImageCurrentOutputs(task).filter(output => output.state !== 'superseded' && output.contentHash)
    .map(output => ({ objectType: 'social-image-candidate', id: output.id, version: output.version,
      contentHash: output.contentHash! }));
}

function derivedNodeStates(task: SocialImageCreationTask): SocialImageProductionNodeState[] {
  const states = Object.fromEntries(SOCIAL_IMAGE_PRODUCTION_NODES.map(node => [node, waiting(node)])) as Record<SocialImageProductionNodeId, SocialImageProductionNodeState>;
  if (task.productionRuntime?.binding) states.task_binding = completed('task_binding');
  else states.task_binding = { ...waiting('task_binding'), status: 'needs_review', blockingReasons: ['social_image_content_task_binding_missing'] };

  const businessReady = Boolean(task.contentBrief.coreClaim.trim() && task.contentBrief.productRefs.length
    && task.deliverySpec.language.trim() && task.deliverySpec.aspectRatio);
  states.business_context = task.schemaVersion !== 'social-image-creation.v3' && businessReady ? completed('business_context') : {
    ...waiting('business_context'), status: 'needs_review', blockingReasons: [
      ...(task.schemaVersion === 'social-image-creation.v3' && businessReady ? ['social_image_business_context_output_required'] : []),
      ...(!task.contentBrief.coreClaim.trim() ? ['social_image_core_claim_missing'] : []),
      ...(!task.contentBrief.productRefs.length ? ['social_image_product_missing'] : []),
    ],
  };

  const requiredAssets = task.enterpriseAssets.filter(asset => asset.required);
  if (task.schemaVersion !== 'social-image-creation.v3' && requiredAssets.length
    && requiredAssets.every(asset => asset.assetId && asset.source.startsWith('enterprise_'))) {
    states.asset_manifest = completed('asset_manifest');
  }
  if (task.creationPath === 'material_processing') states.reference_snapshot = { ...waiting('reference_snapshot'), status: 'skipped' };
  else if (task.schemaVersion !== 'social-image-creation.v3' && task.referenceSnapshot?.fingerprint
    && task.referenceSnapshot.imageUrls.length) states.reference_snapshot = completed('reference_snapshot');
  if (task.creationPath === 'material_processing') states.element_inventory = { ...waiting('element_inventory'), status: 'skipped' };
  else if (task.schemaVersion !== 'social-image-creation.v3' && task.replicationRecipe?.referenceLayerBlueprints?.length) states.element_inventory = completed('element_inventory');
  if (task.creationPath === 'material_processing') {
    states.hook_factors = { ...waiting('hook_factors'), status: 'skipped' };
    states.adaptation = { ...waiting('adaptation'), status: 'skipped' };
  } else {
    if (task.hookFactorSpec && socialImageHookFactorIssues(task.hookFactorSpec).length === 0) states.hook_factors = completed('hook_factors');
    if (task.adaptationSpec) states.adaptation = completed('adaptation');
  }
  // V3 readiness is proved only by persisted node envelopes. Mutable task
  // fields may render a draft but cannot masquerade as completed production.
  if (task.schemaVersion !== 'social-image-creation.v3') {
    if (task.renderBrief && task.imageTextContract.headline.trim()) states.director_brief = completed('director_brief');
    if (task.layerGraph || task.renderPlan) states.execution_plan = completed('execution_plan');
    if (task.layerGraph || task.renderPlan) states.render_spec = completed('render_spec');
  }

  const currentOutputs = socialImageCurrentOutputs(task).filter(output => output.state !== 'superseded');
  const unresolvedJob = task.generationJobs.find(job => job.status === 'outcome_unknown');
  const runningJob = task.generationJobs.find(job => ['queued', 'running', 'output_ready'].includes(job.status));
  if (unresolvedJob) states.candidate_generation = { ...waiting('candidate_generation'), status: 'outcome_unknown', attempt: unresolvedJob.attempt,
    blockingReasons: ['social_image_provider_reconciliation_required'] };
  else if (runningJob || task.status === 'generating') states.candidate_generation = { ...waiting('candidate_generation'), status: 'running', attempt: runningJob?.attempt || 1, blockingReasons: [] };
  else if (currentOutputs.length) states.candidate_generation = completed('candidate_generation');

  // GIF plates are intermediate paid background evidence; only composed
  // frames and the encoded GIF are customer deliverables. A partial set is
  // never quality-ready, even when its first page happens to pass.
  const reviewOutputs = socialImageReviewOutputs(task);
  const qualityReady = reviewOutputs.length > 0 && reviewOutputs.every(output =>
    ['quality_checking', 'approved'].includes(output.state) && socialImageOutputHardChecksPassed(output));
  if (qualityReady) states.quality_check = completed('quality_check');
  else if (currentOutputs.length) states.quality_check = { ...waiting('quality_check'), status: 'needs_review', attempt: 1,
    blockingReasons: ['social_image_hard_quality_gate_incomplete'] };
  const decision = task.directorReviewDecision;
  const directorCurrent = task.schemaVersion === 'social-image-creation.v3'
    ? socialImageDirectorReviewMatchesSet(decision
      ? resolveSocialImageReviewSet(task, decision.candidateId, decision.candidateVersion) : null, decision)
    : decision?.decision === 'accept_for_user_review'
      && (task.imageType !== 'carousel' && task.imageType !== 'gif_poster'
        ? reviewOutputs[0]?.id === decision.candidateId && reviewOutputs[0]?.version === decision.candidateVersion
        : reviewOutputs.length > 0
          && JSON.stringify(reviewOutputs.map(output => `${output.id}:${output.version}:${output.contentHash}`))
          === JSON.stringify(decision.candidateRefs?.map(ref => `${ref.id}:${ref.version}:${ref.contentHash}`)));
  if (directorCurrent) states.director_review = completed('director_review');
  else if (qualityReady) states.director_review = { ...waiting('director_review'), status: 'needs_review', blockingReasons: ['social_image_director_review_required'] };

  const activeRepairs = task.repairInstructions.filter(item => ['pending', 'running', 'failed'].includes(item.status));
  states.repair = activeRepairs.length ? { ...waiting('repair'), status: activeRepairs.some(item => item.status === 'running') ? 'running' : 'needs_review',
    attempt: Math.max(1, activeRepairs.length), blockingReasons: activeRepairs.filter(item => item.status === 'failed').map(() => 'social_image_repair_failed') }
    : { ...waiting('repair'), status: 'skipped' };
  if (task.approvedArtifact) states.user_approval = completed('user_approval');
  else if (qualityReady && directorCurrent) {
    states.user_approval = { ...waiting('user_approval'), status: 'needs_review', blockingReasons: ['social_image_explicit_user_approval_required'] };
  }
  if (task.deliveryPackages?.length) states.delivery = completed('delivery');
  else if (task.approvedArtifact) states.delivery = { ...waiting('delivery'), status: 'needs_review', blockingReasons: ['social_image_delivery_package_not_created'] };
  const latestOutputs = new Map<SocialImageProductionNodeId, SocialImageProductionRuntime['nodeOutputs'][number]>();
  for (const output of task.productionRuntime?.nodeOutputs || []) {
    const current = latestOutputs.get(output.nodeId);
    if (!current || output.version > current.version) latestOutputs.set(output.nodeId, output);
  }
  for (const [nodeId, output] of latestOutputs) {
    states[nodeId] = { nodeId, status: output.status, attempt: output.version, outputRef: {
      objectType: output.schemaVersion, id: output.id, version: output.version, contentHash: output.contentHash,
    }, blockingReasons: output.blockingReasons, startedAt: output.createdAt, finishedAt: output.updatedAt };
  }
  return SOCIAL_IMAGE_PRODUCTION_NODES.map(node => states[node]);
}

function activeNode(states: SocialImageProductionNodeState[]): SocialImageProductionNodeState {
  return states.find(state => !['completed', 'skipped'].includes(state.status)) || states.at(-1)!;
}

const userFacingNode: Record<SocialImageProductionNodeId, { label: string; summary: string }> = {
  task_binding: { label: '建立图片任务', summary: '正在绑定统一内容任务并核对版本。' },
  business_context: { label: '核对生产条件', summary: '正在核对产品、事实、平台和交付要求。' },
  asset_manifest: { label: '核验企业素材', summary: '正在核验产品图片、品牌素材及其使用授权。' },
  reference_snapshot: { label: '读取参考内容', summary: '正在读取参考内容并冻结精确版本。' },
  element_inventory: { label: '拆解参考画面', summary: '正在识别参考画面的构图、文字、主体与显著区域。' },
  hook_factors: { label: '筛选关键爆点', summary: '编导正在从证据中筛选最重要的 4–5 个爆点。' },
  adaptation: { label: '制定差异化策略', summary: '正在明确保留、等价、替换与创新的边界。' },
  director_brief: { label: '形成导演方案', summary: '正在把爆点和企业事实整理为可验收的导演方案。' },
  execution_plan: { label: '规划制作路线', summary: '正在选择制作路线、回退方案和最小执行范围。' },
  render_spec: { label: '冻结图片规格', summary: '正在冻结版位、图层、文字、安全区和资产哈希。' },
  candidate_generation: { label: '生成图片候选', summary: '正在按冻结规格生成候选；进度以服务端回执为准。' },
  quality_check: { label: '检查图片质量', summary: '正在检查文件、版式、事实、爆点和品牌一致性。' },
  director_review: { label: '编导独立复核', summary: '编导正在依据候选证据逐项复核爆点与差异化结果。' },
  repair: { label: '定点修复图片', summary: '只修复失败区域，已通过的图片与证据保持不变。' },
  user_approval: { label: '验收图片候选', summary: '图片已完成检查，请逐项采用或指出需要修改的内容。' },
  delivery: { label: '整理图片交付', summary: '正在从已采用的精确版本生成交付包，不会自动发布。' },
};

function decisionRequest(task: SocialImageCreationTask, current: SocialImageProductionNodeState) {
  const candidateRefs = socialImageReviewOutputs(task).map(output => ({ objectType: 'social-image-candidate',
    id: output.id, version: output.version, contentHash: output.contentHash || '' })).filter(ref => ref.contentHash);
  const definition = current.status === 'outcome_unknown'
    ? { kind: 'reconcile_provider' as const, label: '继续核对结果' }
    : current.nodeId === 'business_context' && ['needs_review', 'blocked'].includes(current.status)
      ? { kind: 'supply_input' as const, label: '补充必要信息' }
      : ['asset_manifest', 'reference_snapshot'].includes(current.nodeId) && current.status === 'blocked'
        ? { kind: 'supply_input' as const, label: '处理素材或授权' }
        : current.nodeId === 'candidate_generation' && current.status === 'waiting'
          ? { kind: 'confirm_generation' as const, label: '确认并开始' }
          : current.nodeId === 'repair' && current.status === 'needs_review'
            ? { kind: 'repair' as const, label: '选择修复方案' }
            : current.nodeId === 'user_approval' && current.status === 'needs_review'
              ? { kind: 'review_candidates' as const, label: '逐项验收' }
              : null;
  if (!definition) return null;
  const idempotencyKey = `social-image-action:${createHash('sha256').update(JSON.stringify({ taskId: task.id,
    taskVersion: task.version, nodeId: current.nodeId, kind: definition.kind, candidateRefs })).digest('hex').slice(0, 32)}`;
  return { decisionId: `${task.id}:${task.version}:${current.nodeId}:${definition.kind}`, ...definition,
    taskVersion: task.version, idempotencyKey, candidateRefs };
}

function event(input: {
  runtime: SocialImageProductionRuntime;
  task: SocialImageCreationTask;
  node: SocialImageProductionNodeState;
  occurredAt: string;
}): SocialImageProductionEvent {
  return {
    schemaVersion: 'social-image-production-event.v1',
    sequence: input.runtime.nextEventSequence,
    eventId: randomUUID(),
    productionRunId: input.task.id,
    nodeId: input.node.nodeId,
    status: input.node.status,
    messageKey: `social_image.node.${input.node.nodeId}.${input.node.status}`,
    occurredAt: input.occurredAt,
    taskVersion: input.task.version,
    blockingReasons: input.node.blockingReasons,
    artifactRefs: currentArtifactRefs(input.task),
  };
}

export function initializeSocialImageProductionRuntime(
  task: SocialImageCreationTask,
  binding: SocialImageProductionBinding | undefined,
  now: string,
): SocialImageProductionRuntime {
  const seed = { schemaVersion: 'social-image-production-runtime.v1' as const, binding, currentNode: 'task_binding' as const,
    nodes: [] as SocialImageProductionNodeState[], events: [] as SocialImageProductionEvent[],
    nodeOutputs: [], nextEventSequence: 1 };
  const withBinding = { ...task, productionRuntime: seed };
  const nodes = derivedNodeStates(withBinding);
  const current = activeNode(nodes);
  const runtime = { ...seed, currentNode: current.nodeId, nodes };
  const created = event({ runtime, task: withBinding, node: current, occurredAt: now });
  return { ...runtime, events: [created], nextEventSequence: 2 };
}

export function evolveSocialImageProductionRuntime(
  previous: SocialImageCreationTask,
  next: SocialImageCreationTask,
  now: string,
): SocialImageProductionRuntime | undefined {
  const runtime = next.productionRuntime || previous.productionRuntime;
  if (!runtime) return next.productionRuntime;
  const normalizedRuntime = { ...runtime, nodeOutputs: runtime.nodeOutputs || [], events: runtime.events || [] };
  const candidate = { ...next, productionRuntime: normalizedRuntime };
  const nodes = derivedNodeStates(candidate);
  const current = activeNode(nodes);
  const before = activeNode(normalizedRuntime.nodes.length ? normalizedRuntime.nodes : derivedNodeStates(previous));
  if (before.nodeId === current.nodeId && before.status === current.status
    && JSON.stringify(before.blockingReasons) === JSON.stringify(current.blockingReasons)
    && JSON.stringify(currentArtifactRefs(previous)) === JSON.stringify(currentArtifactRefs(candidate))) {
    return { ...normalizedRuntime, currentNode: current.nodeId, nodes };
  }
  const base = { ...normalizedRuntime, currentNode: current.nodeId, nodes };
  const nextEvent = event({ runtime: base, task: candidate, node: current, occurredAt: now });
  return { ...base, events: [...normalizedRuntime.events, nextEvent], nextEventSequence: normalizedRuntime.nextEventSequence + 1 };
}

export function projectSocialImageProductionSnapshot(task: SocialImageCreationTask): SocialImageProductionSnapshot {
  const nodes = task.productionRuntime?.nodes.length ? task.productionRuntime.nodes : derivedNodeStates(task);
  const current = activeNode(nodes);
  const index = SOCIAL_IMAGE_PRODUCTION_NODES.indexOf(current.nodeId);
  const businessStage = index <= 2 ? 'clarify' : index <= 8 ? 'plan' : index <= 12 ? 'produce' : 'accept';
  const plan = task.renderPlan;
  const completedJobs = plan?.units.filter(unit => task.generationJobs.some(job => job.id === unit.jobId && job.status === 'completed')).length || 0;
  const providerUnknown = task.generationJobs.some(job => job.status === 'outcome_unknown');
  const reviewOutputs = socialImageReviewOutputs(task);
  const approvalProgress = current.nodeId === 'user_approval' && reviewOutputs.length
    ? { kind: 'known' as const, completed: reviewOutputs.filter(output => output.state === 'approved').length, total: reviewOutputs.length }
    : null;
  const previews = socialImageCurrentOutputs(task).filter(output => output.state !== 'superseded').map(output => ({
    candidateId: output.id, candidateVersion: output.version, contentHash: output.contentHash || null,
    state: output.state as Exclude<SocialImageOutputNode['state'], 'superseded'>,
    ...(output.mediaUrl ? { mediaUrl: output.mediaUrl } : {}),
    ...(output.materialId ? { materialId: output.materialId } : {}),
  }));
  return {
    schemaVersion: 'social-image-production-snapshot.v1',
    contentTaskId: task.productionRuntime?.binding?.contentTaskId || null,
    productionRunId: task.id,
    taskVersion: task.version,
    businessStage,
    currentNode: current.nodeId,
    currentStatus: current.status,
    progress: approvalProgress || (plan?.units.length ? { kind: 'known', completed: completedJobs, total: plan.units.length } : { kind: 'indeterminate' }),
    activityKey: `social_image.node.${current.nodeId}.${current.status}`,
    nodeLabel: userFacingNode[current.nodeId].label,
    userFacingSummary: userFacingNode[current.nodeId].summary,
    waitingFor: providerUnknown ? 'provider_reconciliation'
      : ['quality_check', 'director_review', 'delivery'].includes(current.nodeId) && ['waiting', 'needs_review', 'running'].includes(current.status) ? 'system'
        : current.status === 'needs_review' || current.status === 'blocked' ? 'user'
          : current.status === 'running' ? 'system' : null,
    canApprove: current.nodeId === 'user_approval' && current.status === 'needs_review',
    decisionRequest: decisionRequest(task, current),
    blockingReasons: current.blockingReasons,
    previews,
    latestEventSequence: task.productionRuntime?.events.at(-1)?.sequence || 0,
    updatedAt: task.updatedAt,
  };
}
