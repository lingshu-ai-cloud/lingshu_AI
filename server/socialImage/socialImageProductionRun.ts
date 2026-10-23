import { createHash, randomUUID } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import {
  SOCIAL_IMAGE_HARD_CHECKS,
  socialImageCurrentOutputs,
  socialImageTaskCanPublish,
  type SocialImageCreationTask,
} from '../../shared/contracts/socialImageCreation.js';
import {
  socialImageAdaptationIssues,
  socialImageHookFactorIssues,
  socialImageNodeEnvelopeIssues,
  type SocialImageAdaptationSpec,
  type SocialImageApprovalDecision,
  type SocialImageDeliveryPackage,
  type SocialImageDirectorReviewDecision,
  type SocialImageHookFactorSpec,
  type SocialImageNodeEnvelope,
  type SocialImageNodeValueMap,
  type SocialImageProductionBinding,
  type SocialImageProductionNodeId,
  type SocialImageProductionNodeStatus,
  type SocialImageVersionedRef,
} from '../../shared/contracts/socialImageProduction.js';
import { socialTaskSummary } from '../starter198/socialContentRecords.js';
import { STARTER_COLLECTIONS, type StarterRecord } from '../starter198/repository.js';
import { defaultSocialImageTask, readSocialImageTask, SOCIAL_IMAGE_TASKS_COLLECTION, updateSocialImageTask } from './socialImageTask.js';
import { initializeSocialImageProductionRuntime, projectSocialImageProductionSnapshot } from './socialImageProductionRuntime.js';
import { resolveSocialImageReviewSet, socialImageReviewRefsMatch } from './socialImageReviewSet.js';

export class SocialImageProductionRunError extends Error {
  constructor(readonly code: string, readonly status = 409) {
    super(code);
    this.name = 'SocialImageProductionRunError';
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonical(item)]));
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function boundedIdentity(value: unknown, code: string, maximum = 120): string {
  const text = String(value || '').trim();
  if (!text || text.length > maximum || !/^[a-zA-Z0-9._:@-]+$/.test(text)) throw new SocialImageProductionRunError(code, 400);
  return text;
}

function platform(value: string | undefined): SocialImageCreationTask['deliverySpec']['platform'] {
  const normalized = String(value || '').toLowerCase();
  return ['facebook', 'instagram', 'tiktok', 'youtube', 'linkedin'].includes(normalized)
    ? normalized as SocialImageCreationTask['deliverySpec']['platform'] : 'facebook';
}

function aspectRatio(value: string | null | undefined): SocialImageCreationTask['deliverySpec']['aspectRatio'] {
  return ['1:1', '4:5', '9:16', '16:9'].includes(String(value))
    ? value as SocialImageCreationTask['deliverySpec']['aspectRatio'] : '4:5';
}

async function canonicalContentTask(store: DataStore, tenantId: string, contentTaskId: string) {
  const rows = await store.list<StarterRecord>(STARTER_COLLECTIONS.socialContentTasks, {
    where: { tenant_id: tenantId, task_id: contentTaskId }, perPage: 2,
  });
  if (rows.totalItems > 1 || rows.items.length > 1) throw new SocialImageProductionRunError('social_image_content_task_integrity_violation', 503);
  const row = rows.items[0];
  if (!row) throw new SocialImageProductionRunError('social_image_content_task_not_found', 404);
  return socialTaskSummary(row);
}

export interface CreateBoundSocialImageRunInput {
  contentTaskId: string;
  expectedContentTaskVersion: string;
  idempotencyKey: string;
  deliverableKey?: string;
  entrySource: 'assistant' | 'workspace' | 'weekly_package';
  imageType?: SocialImageCreationTask['imageType'];
}

function sameBoundRunScope(
  task: SocialImageCreationTask,
  contentTaskId: string,
  deliverableKey: string,
  imageType: SocialImageCreationTask['imageType'],
): boolean {
  const binding = task.productionRuntime?.binding;
  return Boolean(binding
    && binding.contentTaskId === contentTaskId
    && binding.deliverableKey === deliverableKey
    && task.imageType === imageType);
}

const GENERIC_NODE_OUTPUTS = new Set<SocialImageProductionNodeId>([
  'business_context', 'asset_manifest', 'reference_snapshot', 'element_inventory', 'hook_factors',
  'adaptation', 'director_brief', 'execution_plan', 'render_spec',
]);

export async function recordSocialImageNodeOutput<N extends keyof SocialImageNodeValueMap>(input: {
  store: DataStore;
  tenantId: string;
  taskId: string;
  expectedVersion: number;
  nodeId: N;
  status: Extract<SocialImageProductionNodeStatus, 'completed' | 'needs_review' | 'blocked' | 'failed' | 'outcome_unknown'>;
  value: SocialImageNodeValueMap[N];
  inputRefs: SocialImageVersionedRef[];
  evidenceRefs?: SocialImageVersionedRef[];
  createdBy: { kind: 'agent' | 'worker' | 'system'; id: string };
  warnings?: string[];
  blockingReasons?: string[];
  taskPatch?: Partial<Pick<SocialImageCreationTask, 'hookFactorSpec' | 'adaptationSpec' | 'renderBrief' | 'imageTextContract'
    | 'layerGraph' | 'step' | 'status'>>;
  now?: string;
}): Promise<SocialImageCreationTask> {
  if (!GENERIC_NODE_OUTPUTS.has(input.nodeId)) throw new SocialImageProductionRunError('social_image_node_writer_invalid', 400);
  const task = await readSocialImageTask(input.store, input.tenantId, input.taskId);
  if (!task) throw new SocialImageProductionRunError('social_image_task_missing', 404);
  if (task.version !== input.expectedVersion) throw new SocialImageProductionRunError('social_image_version_conflict', 409);
  if (input.nodeId === 'hook_factors' && input.status === 'completed') {
    const issues = socialImageHookFactorIssues(input.value as SocialImageHookFactorSpec);
    if (issues.length) throw new SocialImageProductionRunError(issues.join(','), 422);
  }
  if (input.nodeId === 'asset_manifest' && input.status === 'completed') {
    const manifest = input.value as SocialImageNodeValueMap['asset_manifest'];
    const requiredAssetIds = new Set(task.enterpriseAssets.filter(asset => asset.required).map(asset => asset.assetId));
    const observedAssetIds = new Set((manifest.assets || []).filter(asset => asset.required).map(asset => asset.assetId));
    if (!requiredAssetIds.size || [...requiredAssetIds].some(assetId => !observedAssetIds.has(assetId))
      || !Array.isArray(manifest.requiredEvidence) || [...requiredAssetIds].some(assetId => !manifest.requiredEvidence.includes(assetId))
      || !Array.isArray(manifest.assets) || manifest.assets.some(asset => asset.required
      && (!asset.readable || !/^[a-f0-9]{64}$/.test(asset.contentHash)
        || !asset.dimensions?.width || !asset.dimensions?.height || asset.rights !== 'cleared'))) {
      throw new SocialImageProductionRunError('social_image_required_asset_evidence_invalid', 422);
    }
  }
  if (input.nodeId === 'element_inventory' && input.status === 'completed') {
    const inventory = input.value as SocialImageNodeValueMap['element_inventory'];
    const validBox = (box: { x: number; y: number; width: number; height: number }) => [box.x, box.y, box.width, box.height].every(Number.isFinite)
      && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0 && box.x + box.width <= 1.001 && box.y + box.height <= 1.001;
    const regionIds = new Set((inventory.regions || []).map(region => region.regionId));
    if (!inventory.regions?.length || inventory.regions.some(region => !validBox(region.bbox)
      || !region.evidenceRef?.id || !/^[a-f0-9]{64}$/.test(region.evidenceRef.contentHash))
      || inventory.ocrBlocks?.some(block => !validBox(block.bbox) || !block.text.trim()
        || !Number.isFinite(block.confidence) || block.confidence < 0 || block.confidence > 1)
      || !inventory.saliencyOrder?.length || inventory.saliencyOrder.some(regionId => !regionIds.has(regionId))) {
      throw new SocialImageProductionRunError('social_image_element_inventory_evidence_invalid', 422);
    }
  }
  if (input.nodeId === 'adaptation' && input.status === 'completed') {
    const hookSpec = task.hookFactorSpec;
    if (!hookSpec) throw new SocialImageProductionRunError('social_image_hook_factor_output_required', 422);
    const issues = socialImageAdaptationIssues(input.value as SocialImageAdaptationSpec, hookSpec);
    if (issues.length) throw new SocialImageProductionRunError(issues.join(','), 422);
  }
  const runtime = task.productionRuntime;
  if (!runtime?.binding) throw new SocialImageProductionRunError('social_image_content_task_binding_missing', 409);
  const nodeIndex = runtime.nodes.findIndex(node => node.nodeId === input.nodeId);
  if (nodeIndex < 1) throw new SocialImageProductionRunError('social_image_node_state_missing', 503);
  const unmet = runtime.nodes.slice(0, nodeIndex).find(node => !['completed', 'skipped'].includes(node.status));
  if (unmet) throw new SocialImageProductionRunError(`social_image_node_dependency_incomplete:${unmet.nodeId}`, 409);
  const nodeHistory = runtime.nodeOutputs.filter(output => output.nodeId === input.nodeId);
  const current = nodeHistory.sort((left, right) => right.version - left.version)[0];
  const contentHash = hash({ value: input.value, inputRefs: input.inputRefs, evidenceRefs: input.evidenceRefs || [] });
  if (current?.contentHash === contentHash && current.status === input.status) return task;
  const now = input.now || new Date().toISOString();
  const envelope: SocialImageNodeEnvelope<unknown> = {
    schemaVersion: 'social-image-node-envelope.v1',
    id: randomUUID(), tenantId: input.tenantId, contentTaskId: runtime.binding.contentTaskId,
    productionRunId: task.id, nodeId: input.nodeId, version: (current?.version || 0) + 1,
    status: input.status, inputRefs: structuredClone(input.inputRefs), createdBy: input.createdBy,
    createdAt: now, updatedAt: now, contentHash, evidenceRefs: structuredClone(input.evidenceRefs || []),
    warnings: (input.warnings || []).slice(0, 50), blockingReasons: (input.blockingReasons || []).slice(0, 50),
    value: structuredClone(input.value),
  };
  const envelopeIssues = socialImageNodeEnvelopeIssues(envelope);
  if (envelopeIssues.length) throw new SocialImageProductionRunError(envelopeIssues.join(','), 422);
  const invalidations = new Map<SocialImageProductionNodeId, SocialImageNodeEnvelope<unknown>>();
  for (const output of runtime.nodeOutputs) {
    const index = runtime.nodes.findIndex(node => node.nodeId === output.nodeId);
    const latest = invalidations.get(output.nodeId);
    if (index > nodeIndex && (!latest || output.version > latest.version)) invalidations.set(output.nodeId, output);
  }
  const staleOutputs = [...invalidations.values()].map(output => ({ ...output, id: randomUUID(), version: output.version + 1,
    status: 'stale' as const, createdAt: now, updatedAt: now,
    blockingReasons: [...new Set([...output.blockingReasons, `upstream_changed:${input.nodeId}`])] }));
  const nextRuntime = { ...runtime, nodeOutputs: [...runtime.nodeOutputs, envelope, ...staleOutputs] };
  const candidateGenerationIndex = runtime.nodes.findIndex(node => node.nodeId === 'candidate_generation');
  const invalidatesCandidates = candidateGenerationIndex >= 0 && nodeIndex < candidateGenerationIndex;
  const invalidationPatch: Partial<SocialImageCreationTask> = invalidatesCandidates ? {
    outputs: task.outputs.map(output => output.state === 'superseded' ? output : { ...output, state: 'superseded' as const }),
    repairInstructions: task.repairInstructions.map(instruction => ['pending', 'running'].includes(instruction.status)
      ? { ...instruction, status: 'failed' as const } : instruction),
    directorReviewDecision: undefined,
    approvedArtifact: undefined,
    status: 'planned',
    step: 'plan',
  } : {};
  const result = await updateSocialImageTask(input.store, input.tenantId, task.id, task.version, {
    ...(input.taskPatch || {}), ...invalidationPatch, productionRuntime: nextRuntime,
  });
  if (result.kind !== 'updated') throw new SocialImageProductionRunError(result.kind === 'conflict'
    ? 'social_image_version_conflict' : result.kind === 'invalid' ? result.issues.join(',') : 'social_image_node_output_persist_failed', result.kind === 'conflict' ? 409 : 422);
  return result.task;
}

export async function createOrResumeBoundSocialImageRun(
  store: DataStore,
  tenantId: string,
  input: CreateBoundSocialImageRunInput,
  now = new Date().toISOString(),
): Promise<{ task: SocialImageCreationTask; resumed: boolean }> {
  const contentTaskId = boundedIdentity(input.contentTaskId, 'social_image_content_task_id_invalid', 240);
  const idempotencyKey = boundedIdentity(input.idempotencyKey, 'social_image_idempotency_key_invalid', 128);
  if (idempotencyKey.length < 8) throw new SocialImageProductionRunError('social_image_idempotency_key_invalid', 400);
  const deliverableKey = boundedIdentity(input.deliverableKey || 'primary-image', 'social_image_deliverable_key_invalid', 80);
  const contentTask = await canonicalContentTask(store, tenantId, contentTaskId);
  if (String(contentTask.version) !== String(input.expectedContentTaskVersion)) {
    throw new SocialImageProductionRunError('social_image_content_task_version_conflict', 409);
  }
  const productionRunId = `img${hash({ tenantId, contentTaskId, deliverableKey }).slice(0, 12)}`;
  const requestedImageType = input.imageType || 'product_poster';
  // Entry source is presentation provenance, not run identity. The same
  // ContentTask must resume when an assistant-created task is later opened in
  // the workspace (or vice versa).
  const requestValue = { contentTaskId, deliverableKey, imageType: requestedImageType };
  const requestHash = hash(requestValue);
  const existing = await readSocialImageTask(store, tenantId, productionRunId);
  if (existing) {
    if (existing.productionRuntime?.binding?.requestHash !== requestHash
      && !sameBoundRunScope(existing, contentTaskId, deliverableKey, requestedImageType)) {
      throw new SocialImageProductionRunError('social_image_run_scope_conflict', 409);
    }
    const task = existing.productionRuntime?.binding?.contentTaskVersion === contentTask.version ? existing
      : await refreshSocialImageContentTaskBinding({ store, tenantId, taskId: existing.id,
        expectedVersion: existing.version, expectedContentTaskVersion: contentTask.version, contentTask });
    return { task, resumed: true };
  }

  const brief = contentTask.brief;
  const creationMode = brief.creationMode === 'viral_replication' ? 'viral_replication' : 'free_creation';
  const payload = defaultSocialImageTask({
    title: brief.title,
    imageType: requestedImageType,
    creationPath: creationMode === 'viral_replication' ? 'viral_replication' : 'material_processing',
    coreClaim: brief.objective,
    audience: brief.audience ? [brief.audience] : [],
    productRefs: brief.productId ? [brief.productId] : [],
    productNames: brief.productRef ? [brief.productRef] : [],
  }, now);
  payload.schemaVersion = 'social-image-creation.v3';
  payload.id = productionRunId;
  payload.deliverySpec = {
    ...payload.deliverySpec,
    platform: platform(brief.platforms[0]),
    aspectRatio: aspectRatio(brief.aspectRatio),
    language: brief.languages[0] || 'en',
    outputCount: payload.deliverySpec.outputCount,
    format: payload.deliverySpec.format,
  };
  payload.enterpriseAssets = brief.productId ? [{ assetId: brief.productId, role: 'product', name: brief.productRef || brief.productId,
    source: 'enterprise_knowledge_base', required: true }] : [];
  payload.fieldsToConfirm = [
    ...(!brief.productId ? ['product_identity'] : []),
    ...(!brief.objective.trim() ? ['core_claim'] : []),
  ];
  const binding: SocialImageProductionBinding = {
    schemaVersion: 'social-image-production-binding.v1',
    contentTaskId,
    contentTaskVersion: contentTask.version,
    productionRunId,
    deliverableKey,
    entrySource: input.entrySource,
    creationMode,
    idempotencyKeyHash: hash(idempotencyKey),
    requestHash,
    resumeToken: hash({ tenantId, contentTaskId, productionRunId, requestHash }).slice(0, 40),
    boundAt: now,
  };
  payload.productionRuntime = initializeSocialImageProductionRuntime(payload, binding, now);
  const stored = await store.create<StarterRecord>(SOCIAL_IMAGE_TASKS_COLLECTION, {
    id: productionRunId,
    tenant_id: tenantId,
    title: payload.title,
    status: 'draft',
    workflow_task_id: contentTaskId,
    workflow_task_key: deliverableKey,
    workflow_lineage_hash: requestHash,
    spec: { contentMode: 'image', creationPath: payload.creationPath, contentTaskId, socialImageTask: payload },
    created_at: now,
    updated_at: now,
  });
  if (!stored) {
    const raced = await readSocialImageTask(store, tenantId, productionRunId);
    if (raced && (raced.productionRuntime?.binding?.requestHash === requestHash
      || sameBoundRunScope(raced, contentTaskId, deliverableKey, requestedImageType))) return { task: raced, resumed: true };
    throw new SocialImageProductionRunError('social_image_run_create_conflict', 409);
  }
  return { task: payload, resumed: false };
}

export async function refreshSocialImageContentTaskBinding(input: {
  store: DataStore;
  tenantId: string;
  taskId: string;
  expectedVersion: number;
  expectedContentTaskVersion: string;
  contentTask?: ReturnType<typeof socialTaskSummary>;
  now?: string;
}): Promise<SocialImageCreationTask> {
  const task = await readSocialImageTask(input.store, input.tenantId, input.taskId);
  if (!task) throw new SocialImageProductionRunError('social_image_task_missing', 404);
  if (task.version !== input.expectedVersion) throw new SocialImageProductionRunError('social_image_version_conflict', 409);
  const binding = task.productionRuntime?.binding;
  if (!binding) throw new SocialImageProductionRunError('social_image_content_task_binding_missing', 409);
  const contentTask = input.contentTask || await canonicalContentTask(input.store, input.tenantId, binding.contentTaskId);
  if (contentTask.taskId !== binding.contentTaskId || contentTask.version !== input.expectedContentTaskVersion) {
    throw new SocialImageProductionRunError('social_image_content_task_version_conflict', 409);
  }
  if (binding.contentTaskVersion === contentTask.version) return task;
  const now = input.now || new Date().toISOString();
  const runtime = task.productionRuntime!;
  const sourceRef: SocialImageVersionedRef = { objectType: 'social_content_task', id: contentTask.taskId,
    version: contentTask.version, contentHash: hash(contentTask.brief) };
  const latestOutputs = new Map<SocialImageProductionNodeId, SocialImageNodeEnvelope<unknown>>();
  for (const output of runtime.nodeOutputs) {
    const latest = latestOutputs.get(output.nodeId);
    if (!latest || output.version > latest.version) latestOutputs.set(output.nodeId, output);
  }
  // Only outputs that actually exist can become stale. Synthesizing stale
  // envelopes for derived/skipped nodes made free-creation runs stop forever
  // at reference analysis even though that branch is intentionally skipped.
  const productChanged = task.contentBrief.productRefs[0] !== (contentTask.brief.productId || undefined);
  const refreshAffectedNodes = new Set<SocialImageProductionNodeId>([
    'business_context', 'hook_factors', 'adaptation', 'director_brief', 'execution_plan', 'render_spec',
    ...(productChanged ? ['asset_manifest' as const] : []),
  ]);
  const staleTargets = [...latestOutputs.values()].filter(output => GENERIC_NODE_OUTPUTS.has(output.nodeId)
    && refreshAffectedNodes.has(output.nodeId)
    && output.status !== 'stale'
    && !(task.creationPath === 'material_processing' && ['hook_factors', 'adaptation'].includes(output.nodeId)));
  const staleOutputs: Array<SocialImageNodeEnvelope<unknown>> = staleTargets.map(output => ({
    schemaVersion: 'social-image-node-envelope.v1', id: randomUUID(), tenantId: input.tenantId,
    contentTaskId: binding.contentTaskId, productionRunId: task.id, nodeId: output.nodeId,
    version: output.version + 1, status: 'stale', inputRefs: [sourceRef],
    createdBy: { kind: 'system', id: 'content_task_binding_refresh' }, createdAt: now, updatedAt: now,
    contentHash: hash({ nodeId: output.nodeId, contentTask: sourceRef }), evidenceRefs: [sourceRef], warnings: [],
    blockingReasons: ['social_image_content_task_changed'], value: { reason: 'content_task_changed' },
  }));
  const nextRuntime = { ...runtime, binding: { ...binding, contentTaskVersion: contentTask.version, boundAt: now },
    nodeOutputs: [...runtime.nodeOutputs, ...staleOutputs] };
  const brief = contentTask.brief;
  const result = await updateSocialImageTask(input.store, input.tenantId, task.id, task.version, {
    productionRuntime: nextRuntime, status: 'draft', step: 'inputs', directorReviewDecision: undefined,
    approvedArtifact: undefined,
    outputs: task.outputs.map(output => output.state === 'superseded' ? output : { ...output, state: 'superseded' as const }),
    repairInstructions: task.repairInstructions.map(instruction => ['pending', 'running'].includes(instruction.status)
      ? { ...instruction, status: 'failed' as const } : instruction),
    renderBrief: undefined,
    layerGraph: undefined,
    renderPlan: undefined,
    gifDelivery: undefined,
    adaptationSpec: undefined,
    ...(task.creationPath === 'viral_replication' ? { hookFactorSpec: undefined } : {}),
    imageTextContract: { ...task.imageTextContract, headline: '', supportingText: '', caption: '', hashtags: [], cta: undefined,
      requiredFacts: [], prohibitedInferences: [], visualMustShow: [], visualMustNotImply: [] },
    contentBrief: { ...task.contentBrief, coreClaim: brief.objective, productRefs: brief.productId ? [brief.productId] : [],
      productNames: brief.productRef ? [brief.productRef] : [], audience: brief.audience ? [brief.audience] : [] },
    deliverySpec: { ...task.deliverySpec, platform: platform(brief.platforms[0]), aspectRatio: aspectRatio(brief.aspectRatio),
      language: brief.languages[0] || task.deliverySpec.language },
    fieldsToConfirm: [...(!brief.productId ? ['product_identity'] : []), ...(!brief.objective.trim() ? ['core_claim'] : [])],
  });
  if (result.kind !== 'updated') throw new SocialImageProductionRunError(result.kind === 'conflict'
    ? 'social_image_version_conflict' : result.kind === 'invalid' ? result.issues.join(',') : 'social_image_binding_refresh_failed', result.kind === 'conflict' ? 409 : 422);
  return result.task;
}

export async function recordSocialImageHookStrategy(input: {
  store: DataStore;
  tenantId: string;
  taskId: string;
  expectedVersion: number;
  hookFactorSpec: SocialImageHookFactorSpec;
  adaptationSpec: SocialImageAdaptationSpec;
}) {
  const issues = socialImageHookFactorIssues(input.hookFactorSpec);
  issues.push(...socialImageAdaptationIssues(input.adaptationSpec, input.hookFactorSpec));
  if (issues.length) throw new SocialImageProductionRunError(issues.join(','), 422);
  const hooked = await recordSocialImageNodeOutput({
    ...input, nodeId: 'hook_factors', status: 'completed', value: input.hookFactorSpec,
    inputRefs: [], evidenceRefs: input.hookFactorSpec.factors.flatMap(factor => factor.evidenceRefs),
    createdBy: { kind: 'agent', id: 'image_director' }, taskPatch: { hookFactorSpec: input.hookFactorSpec, step: 'plan' },
  });
  const hookEnvelope = hooked.productionRuntime!.nodeOutputs.filter(output => output.nodeId === 'hook_factors').at(-1)!;
  return recordSocialImageNodeOutput({
    ...input, expectedVersion: hooked.version, nodeId: 'adaptation', status: 'completed', value: input.adaptationSpec,
    inputRefs: [{ objectType: hookEnvelope.schemaVersion, id: hookEnvelope.id, version: hookEnvelope.version, contentHash: hookEnvelope.contentHash }],
    createdBy: { kind: 'agent', id: 'image_director' }, taskPatch: { adaptationSpec: input.adaptationSpec, step: 'plan' },
  });
}

export async function recordSocialImageDirectorReview(input: {
  store: DataStore;
  tenantId: string;
  taskId: string;
  expectedVersion: number;
  decision: SocialImageDirectorReviewDecision;
}) {
  const task = await readSocialImageTask(input.store, input.tenantId, input.taskId);
  if (!task) throw new SocialImageProductionRunError('social_image_task_missing', 404);
  if (task.version !== input.expectedVersion) throw new SocialImageProductionRunError('social_image_version_conflict', 409);
  const reviewSet = resolveSocialImageReviewSet(task, input.decision.candidateId, input.decision.candidateVersion);
  if (!reviewSet) throw new SocialImageProductionRunError('social_image_review_candidate_stale', 409);
  if ((task.imageType === 'carousel' || task.imageType === 'gif_poster')
    && (!socialImageReviewRefsMatch(reviewSet.refs, input.decision.candidateRefs)
      || input.decision.candidateSetHash !== reviewSet.contentHash)) {
    throw new SocialImageProductionRunError('social_image_review_set_mismatch', 409);
  }
  if (input.decision.decision === 'accept_for_user_review' && !reviewSet.qualityPassed) {
    throw new SocialImageProductionRunError('social_image_hard_quality_gate_incomplete', 422);
  }
  const result = await updateSocialImageTask(input.store, input.tenantId, input.taskId, input.expectedVersion, {
    directorReviewDecision: input.decision,
    status: 'review_required',
    step: 'review',
  });
  if (result.kind !== 'updated') throw new SocialImageProductionRunError(result.kind === 'conflict' ? 'social_image_version_conflict' : 'social_image_review_persist_failed', result.kind === 'conflict' ? 409 : 422);
  return result.task;
}

/**
 * Project an independent director decision from the persisted quality evidence.
 * The browser supplies only candidate identity; it cannot submit or forge the
 * review verdict. No provider is called here, so unresolved visual evidence
 * remains fail-closed instead of being converted into a pass.
 */
export async function runSocialImageDirectorReview(input: {
  store: DataStore;
  tenantId: string;
  taskId: string;
  expectedVersion: number;
  candidateId: string;
  candidateVersion: number;
  now?: string;
}): Promise<SocialImageCreationTask> {
  const task = await readSocialImageTask(input.store, input.tenantId, input.taskId);
  if (!task) throw new SocialImageProductionRunError('social_image_task_missing', 404);
  if (task.version !== input.expectedVersion) throw new SocialImageProductionRunError('social_image_version_conflict', 409);
  const snapshot = projectSocialImageProductionSnapshot(task);
  if (snapshot.currentNode !== 'director_review' || snapshot.currentStatus !== 'needs_review') {
    throw new SocialImageProductionRunError('social_image_director_review_not_ready', 422);
  }
  const reviewSet = resolveSocialImageReviewSet(task, input.candidateId, input.candidateVersion);
  if (!reviewSet) throw new SocialImageProductionRunError('social_image_review_candidate_stale', 409);
  if (!reviewSet.qualityPassed) {
    throw new SocialImageProductionRunError('social_image_hard_quality_gate_incomplete', 422);
  }
  const referenceChecks = reviewSet.outputs.map(output => output.qualityChecks.find(check => check.key === 'reference_structure_similarity'));
  const referenceReady = task.creationPath !== 'viral_replication'
    || referenceChecks.every(check => check && ['pass', 'not_applicable'].includes(check.verdict));
  const factorResults = (task.hookFactorSpec?.factors || []).map(factor => ({
    factorId: factor.factorId,
    verdict: referenceReady ? 'pass' as const : 'uncertain' as const,
    evidenceRefs: [...factor.evidenceRefs, ...reviewSet.refs],
  }));
  const failedCriteria = referenceReady ? [] : ['reference_structure_similarity'];
  const hardChecks = reviewSet.outputs.flatMap(output => SOCIAL_IMAGE_HARD_CHECKS.map(key =>
    output.qualityChecks.find(check => check.key === key && check.severity === 'hard')));
  const decision: SocialImageDirectorReviewDecision = {
    schemaVersion: 'social-image-director-review.v1',
    decision: referenceReady ? 'accept_for_user_review' : 'repair',
    candidateId: reviewSet.anchor.id,
    candidateVersion: reviewSet.anchor.version,
    candidateRefs: reviewSet.refs,
    candidateSetHash: reviewSet.contentHash,
    passedCriteria: hardChecks.flatMap(check => check ? [check.key] : []),
    failedCriteria,
    factorResults,
    problemRegions: referenceReady ? [] : referenceChecks.flatMap(check => check?.region ? [JSON.stringify(check.region)] : []),
    reasonCodes: referenceReady ? ['independent_quality_evidence_passed'] : ['reference_evidence_incomplete'],
    repairInstructions: referenceReady ? [] : ['补齐参考结构像素证据后重新审查'],
    reviewConfidence: Math.min(.99, ...hardChecks.map(check => check?.score ?? .8)),
    reviewedAt: input.now || new Date().toISOString(),
  };
  return recordSocialImageDirectorReview({ ...input, decision });
}

export async function decideSocialImageCandidate(input: {
  store: DataStore;
  tenantId: string;
  userId: string;
  taskId: string;
  expectedVersion: number;
  candidateId: string;
  candidateVersion: number;
  expectedContentHash: string;
  actualContentHash: string;
  decision: 'approved' | 'rejected';
  note?: string;
  now?: string;
}) {
  const task = await readSocialImageTask(input.store, input.tenantId, input.taskId);
  if (!task) throw new SocialImageProductionRunError('social_image_task_missing', 404);
  if (task.version !== input.expectedVersion) throw new SocialImageProductionRunError('social_image_version_conflict', 409);
  if (task.schemaVersion !== 'social-image-creation.v3' || !task.productionRuntime?.binding) {
    throw new SocialImageProductionRunError('social_image_content_task_binding_missing', 409);
  }
  const current = socialImageCurrentOutputs(task);
  const output = current.find(candidate => candidate.id === input.candidateId && candidate.version === input.candidateVersion
    && candidate.state !== 'superseded');
  if (!output) throw new SocialImageProductionRunError('social_image_approval_candidate_stale', 409);
  const reviewSet = resolveSocialImageReviewSet(task, output.id, output.version);
  const multi = task.imageType === 'carousel' || task.imageType === 'gif_poster';
  if (input.decision === 'approved' && (!reviewSet || input.expectedContentHash !== reviewSet.contentHash
    || input.actualContentHash !== reviewSet.contentHash)) {
    throw new SocialImageProductionRunError('social_image_candidate_hash_conflict', 409);
  }
  if (input.decision === 'approved' && !reviewSet?.qualityPassed) {
    throw new SocialImageProductionRunError('social_image_hard_quality_gate_incomplete', 422);
  }
  if (input.decision === 'approved' && (task.fieldsToConfirm.length || task.contentBrief.factuality === 'mock')) {
    throw new SocialImageProductionRunError('social_image_approval_inputs_incomplete', 422);
  }
  if (input.decision === 'approved' && (task.directorReviewDecision?.decision !== 'accept_for_user_review'
    || task.directorReviewDecision.candidateId !== output.id || task.directorReviewDecision.candidateVersion !== output.version
    || (multi && (!reviewSet || !socialImageReviewRefsMatch(reviewSet.refs, task.directorReviewDecision.candidateRefs)
      || reviewSet.contentHash !== task.directorReviewDecision.candidateSetHash)))) {
    throw new SocialImageProductionRunError('social_image_director_review_required', 422);
  }
  if (input.decision === 'approved') {
    const snapshot = projectSocialImageProductionSnapshot(task);
    if (snapshot.currentNode !== 'user_approval' || snapshot.currentStatus !== 'needs_review') {
      throw new SocialImageProductionRunError('social_image_workflow_incomplete', 422);
    }
  }
  const decidedAt = input.now || new Date().toISOString();
  const selected = reviewSet?.outputs || [output];
  const qualitySummaryHash = hash(selected.map(candidate => ({ id: candidate.id, checks: candidate.qualityChecks })));
  const directorReviewHash = task.directorReviewDecision ? hash(task.directorReviewDecision) : undefined;
  const decision: SocialImageApprovalDecision = {
    schemaVersion: 'social-image-approval-decision.v1',
    decisionId: randomUUID(),
    decision: input.decision,
    candidateId: output.id,
    candidateVersion: output.version,
    candidateContentHash: input.decision === 'approved' ? reviewSet!.contentHash : (reviewSet?.contentHash || input.actualContentHash),
    ...(reviewSet ? { candidateRefs: reviewSet.refs } : {}),
    decidedBy: input.userId,
    decidedAt,
    source: 'explicit_user_action',
    qualitySummaryHash,
    ...(directorReviewHash ? { directorReviewHash } : {}),
    ...(input.note?.trim() ? { note: input.note.trim().slice(0, 1000) } : {}),
  };
  const approvalDecisions = [...(task.approvalDecisions || []), decision];
  const selectedIds = new Set(selected.map(candidate => candidate.id));
  const outputs = task.outputs.map(candidate => selectedIds.has(candidate.id)
    ? { ...candidate, state: input.decision === 'approved' ? 'approved' as const : 'repair_required' as const }
    : candidate);
  const approvedArtifact = input.decision === 'approved' ? {
    schemaVersion: 'approved-image-artifact.v1' as const,
    artifactId: `imgart_${hash({ taskId: task.id, outputId: output.id, contentHash: reviewSet!.contentHash }).slice(0, 24)}`,
    contentTaskId: task.productionRuntime.binding.contentTaskId,
    productionRunId: task.id,
    candidateId: output.id,
    candidateVersion: output.version,
    contentHash: reviewSet!.contentHash,
    candidateRefs: reviewSet!.refs,
    mediaItems: reviewSet!.outputs.map(candidate => ({ candidateId: candidate.id, role: candidate.role,
      label: candidate.label, ...(candidate.mediaUrl ? { mediaUrl: candidate.mediaUrl } : {}),
      ...(candidate.materialId ? { materialId: candidate.materialId } : {}) })),
    ...(output.mediaUrl ? { mediaUrl: output.mediaUrl } : {}),
    ...(output.materialId ? { materialId: output.materialId } : {}),
    approvalDecisionId: decision.decisionId,
    usageRestrictions: [],
    frozenAt: decidedAt,
  } : undefined;
  const result = await updateSocialImageTask(input.store, input.tenantId, input.taskId, input.expectedVersion, {
    outputs,
    approvalDecisions,
    ...(approvedArtifact ? { approvedArtifact } : {}),
    status: input.decision === 'approved' ? 'approved' : 'review_required',
    step: 'review',
  });
  if (result.kind !== 'updated') throw new SocialImageProductionRunError(result.kind === 'conflict'
    ? 'social_image_version_conflict' : result.kind === 'invalid' ? result.issues.join(',') : 'social_image_approval_persist_failed', result.kind === 'conflict' ? 409 : 422);
  if (input.decision === 'approved' && !socialImageTaskCanPublish(result.task)) {
    throw new SocialImageProductionRunError('social_image_approval_invariant_failed', 503);
  }
  return { task: result.task, decision, approvedArtifact };
}

export async function createSocialImageDeliveryPackage(input: {
  store: DataStore;
  tenantId: string;
  taskId: string;
  expectedVersion: number;
  now?: string;
}): Promise<{ task: SocialImageCreationTask; deliveryPackage: SocialImageDeliveryPackage }> {
  const task = await readSocialImageTask(input.store, input.tenantId, input.taskId);
  if (!task) throw new SocialImageProductionRunError('social_image_task_missing', 404);
  if (task.version !== input.expectedVersion) throw new SocialImageProductionRunError('social_image_version_conflict', 409);
  const binding = task.productionRuntime?.binding;
  const artifact = task.approvedArtifact;
  if (task.status !== 'approved' || !task.publishable || !binding || !artifact) {
    throw new SocialImageProductionRunError('social_image_approved_artifact_required', 422);
  }
  const existing = task.deliveryPackages?.find(item => item.approvedArtifactRef.contentHash === artifact.contentHash
    && item.platformVariant.platform === task.deliverySpec.platform && item.platformVariant.aspectRatio === task.deliverySpec.aspectRatio);
  if (existing) return { task, deliveryPackage: existing };
  const createdAt = input.now || new Date().toISOString();
  const packageVersion = Math.max(0, ...(task.deliveryPackages || []).map(item => item.packageVersion)) + 1;
  const base = {
    schemaVersion: 'social-image-delivery-package.v1' as const,
    packageId: `imgpkg_${hash({ taskId: task.id, artifact: artifact.contentHash, packageVersion }).slice(0, 24)}`,
    contentTaskId: binding.contentTaskId,
    productionRunId: task.id,
    packageVersion,
    status: 'ready' as const,
    approvedArtifactRef: { objectType: artifact.schemaVersion, id: artifact.artifactId, version: artifact.candidateVersion, contentHash: artifact.contentHash },
    platformVariant: {
      platform: task.deliverySpec.platform,
      aspectRatio: task.deliverySpec.aspectRatio,
      language: task.deliverySpec.language,
      ...(artifact.mediaUrl ? { mediaUrl: artifact.mediaUrl } : {}),
      ...(artifact.materialId ? { materialId: artifact.materialId } : {}),
      ...(artifact.mediaItems?.length ? { mediaItems: task.imageType === 'gif_poster'
        ? artifact.mediaItems.filter(item => item.role === 'gif_output') : artifact.mediaItems } : {}),
      caption: task.imageTextContract.caption,
    },
    publicationPackageRefs: [], publicationEvidenceRefs: [], createdAt,
  };
  const deliveryPackage: SocialImageDeliveryPackage = { ...base, packageHash: hash(base) };
  const result = await updateSocialImageTask(input.store, input.tenantId, task.id, task.version, {
    deliveryPackages: [...(task.deliveryPackages || []), deliveryPackage],
  });
  if (result.kind !== 'updated') throw new SocialImageProductionRunError(result.kind === 'conflict'
    ? 'social_image_version_conflict' : result.kind === 'invalid' ? result.issues.join(',') : 'social_image_delivery_package_failed', result.kind === 'conflict' ? 409 : 422);
  return { task: result.task, deliveryPackage };
}
