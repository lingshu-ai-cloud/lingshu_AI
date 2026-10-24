import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { SOCIAL_WORK_PACKAGE_KINDS } from '../../shared/contracts/socialContentWorkflow.js';
import { SOCIAL_IMAGE_HARD_CHECKS, socialImageReviewOutputs, socialImageTaskCanPublish, type SocialImageCreationTask, type SocialImageOutputNode } from '../../shared/contracts/socialImageCreation.js';
import { socialImageHookFactorIssues, type SocialImageHookFactorSpec } from '../../shared/contracts/socialImageProduction.js';
import { defaultBrief } from '../starter198/socialContentTaskSupport.js';
import { STARTER_COLLECTIONS } from '../starter198/repository.js';
import { readSocialImageTask, SOCIAL_IMAGE_TASKS_COLLECTION, updateSocialImageTask } from './socialImageTask.js';
import {
  assertSocialImageCurrentContentTask,
  createOrResumeBoundSocialImageRun,
  createSocialImageDeliveryPackage,
  decideSocialImageCandidate,
  recordSocialImageBusinessContext,
  recordSocialImageNodeOutput,
  recordSocialImageDirectorReview,
  runSocialImageDirectorReview,
} from './socialImageProductionRun.js';
import { projectSocialImageProductionSnapshot } from './socialImageProductionRuntime.js';
import { socialImageV3PaidPrerequisiteIssue, socialImageV3ResolvedAssetIssue,
  socialImageV3SingleRenderInput } from './socialImagePaidPrerequisites.js';
import { compileSocialImageV3PaidPlan, recordSocialImageV3DirectorBrief } from './socialImageFormalPlan.js';
import { inspectSocialImageAsset, socialImageAssetAuthorization, socialImageAssetManifest } from './socialImageEvidenceWorker.js';
import { admitSocialImageV3QueuedJob, claimSocialImagePaidJob, completeSocialImagePaidJob } from './socialImagePaidJob.js';
import { claimSocialImagePlannedUnit, persistSocialImageMultiUnitPlan, socialImagePlannedRenderInput } from './socialImageDurablePlan.js';
import { normalizePosterBrief } from './studioPosterHelpers.js';

class MemoryStore implements DataStore {
  private sequence = 0;
  readonly rows = new Map<string, Record_[]>();
  supportsAtomicCompareAndSwapFor = async () => true;
  async getById<T = Record_>(collection: string, id: string): Promise<T | null> {
    return (this.rows.get(collection) || []).find(item => item.id === id) as T || null;
  }
  async create<T = Record_>(collection: string, data: Record<string, unknown>): Promise<T | null> {
    const rows = this.rows.get(collection) || [];
    const id = String(data.id || `row-${++this.sequence}`);
    if (rows.some(item => item.id === id)) return null;
    const record = { id, ...structuredClone(data) } as Record_;
    this.rows.set(collection, [...rows, record]);
    return record as T;
  }
  async update(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
    const rows = this.rows.get(collection) || [];
    const index = rows.findIndex(item => item.id === id);
    if (index < 0) return false;
    rows[index] = { ...rows[index], ...structuredClone(data) };
    return true;
  }
  async compareAndSwap(collection: string, id: string, expected: Record<string, unknown>, data: Record<string, unknown>): Promise<boolean> {
    const rows = this.rows.get(collection) || [];
    const index = rows.findIndex(item => item.id === id);
    const current = rows[index];
    if (!current || Object.entries(expected).some(([key, value]) => JSON.stringify(current[key]) !== JSON.stringify(value))) return false;
    rows[index] = { ...current, ...structuredClone(data) };
    return true;
  }
  async delete(): Promise<boolean> { return false; }
  async list<T = Record_>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    const all = (this.rows.get(collection) || []).filter(row => Object.entries(query.where || {})
      .every(([key, value]) => String(row[key] ?? '') === String(value)));
    return { items: all as T[], totalItems: all.length, totalPages: all.length ? 1 : 0,
      page: query.page || 1, perPage: query.perPage || 20 };
  }
}

async function fixture() {
  const store = new MemoryStore();
  const now = '2026-10-24T02:00:00.000Z';
  await store.create(STARTER_COLLECTIONS.socialContentTasks, {
    id: 'content-row', tenant_id: 'tenant-a', task_id: 'content-a', status: 'plan_review', version: '7',
    brief: defaultBrief({ title: '秋季产品主视觉', objective: '让品牌采购理解产品低敏定位', mode: 'instant',
      productId: 'product-a', productRef: '产品 A', audience: '品牌采购', platforms: ['instagram'], languages: ['zh'],
      formats: ['social_image'], aspectRatio: '4:5', creationMode: 'material_processing' }),
    task_mode: 'instant', theme_selection: '', script_baseline: '', director_plan: '', material_requirements: [],
    package_selection: SOCIAL_WORK_PACKAGE_KINDS.map(kind => ({ kind, packageKey: kind, version: '1', name: kind })),
    run_id: '', weekly_plan_id: '', source_count: 0, knowledge_source_count: 0, material_source_count: 0,
    artifact_count: 0, approved_artifact_count: 0, delivery_package_count: 0, publication_count: 0,
    metric_submission_count: 0, created_at: now, updated_at: now,
  });
  await store.create('tenant_profiles', { id:'profile-a', tenant_id:'tenant-a',
    profile:{ factVersion:{ id:'enterprise-facts-v1', revision:1, contentHash:'f'.repeat(64), confirmedAt:now, confirmedBy:'owner' } } });
  return { store, now };
}

async function recordReadyAssetManifest(store: DataStore, task: SocialImageCreationTask, now: string) {
  const business = await recordSocialImageBusinessContext({ store, tenantId: 'tenant-a', taskId: task.id,
    expectedVersion: task.version, now });
  return recordSocialImageNodeOutput({ store, tenantId: 'tenant-a', taskId: task.id, expectedVersion: business.version,
    nodeId: 'asset_manifest', status: 'completed', value: { enterpriseFactSnapshotRef: null, assets: [{
      assetId: 'product-a', version: 1, contentHash: 'e'.repeat(64), role: 'product', required: true, readable: true,
      dimensions: { width: 800, height: 1000 }, rights: 'cleared', rightsEvidenceRef: 'license:product-a',
      observedSubjects: [], ocr: ['产品 A'], confidence: 1,
    }], requiredEvidence: ['product-a'], missingCapabilities: [], prohibitedClaims: [] },
    inputRefs: [], evidenceRefs: [{ objectType: 'enterprise-image-asset', id: 'product-a', version: 1, contentHash: 'e'.repeat(64) }],
    createdBy: { kind: 'worker', id: 'fixture_asset_probe' }, now });
}

test('V3 paid asset admission compares current product bytes to the inspected manifest', async () => {
  const { store, now } = await fixture();
  const created = (await createOrResumeBoundSocialImageRun(store, 'tenant-a', {
    contentTaskId: 'content-a', expectedContentTaskVersion: '7', idempotencyKey: 'asset-hash-check',
    entrySource: 'assistant', imageType: 'product_poster',
  }, now)).task;
  const inspected = await recordReadyAssetManifest(store, created, now);
  assert.equal(socialImageV3ResolvedAssetIssue(inspected, {
    productHashes: { 'product-a': 'e'.repeat(64) }, materialHashes: {}, referenceHash: null,
  }), null);
  assert.equal(socialImageV3ResolvedAssetIssue(inspected, {
    productHashes: { 'product-a': 'f'.repeat(64) }, materialHashes: {}, referenceHash: null,
  }), 'social_image_required_asset_bytes_changed');
});

async function recordReadyProductionPlan(store: DataStore, task: SocialImageCreationTask, now: string) {
  const director = await recordSocialImageNodeOutput({ store, tenantId: 'tenant-a', taskId: task.id,
    expectedVersion: task.version, nodeId: 'director_brief', status: 'completed', value: {
      objective: task.contentBrief.coreClaim, singleCoreClaim: task.contentBrief.coreClaim, headline: '低敏产品方案',
      supportingText: '', caption: '', cta: '', requiredFacts: [], prohibitedInferences: [],
      visualMustShow: ['产品 A'], visualMustNotImply: [], compositionIntent: '产品居中',
      imageTextRelation: 'image_contextualizes_copy', visualProof: 'product_hero', brandAndOriginalityRules: [],
      acceptanceCriteria: [{ criterionId: 'product', observableTarget: '产品清晰', validator: 'human_review' }],
      factorSpecRef: null, adaptationSpecRef: null,
    }, inputRefs: [], createdBy: { kind: 'agent', id: 'fixture_director' },
    taskPatch: { renderBrief: { headline: '低敏产品方案', subheadline: '', originBadge: '', trustBadges: [],
      sellingPoints: [], process: [], categories: [], bottomBar: [], cta: '' },
    imageTextContract: { ...task.imageTextContract, headline: '低敏产品方案' } }, now });
  const execution = await recordSocialImageNodeOutput({ store, tenantId: 'tenant-a', taskId: task.id,
    expectedVersion: director.version, nodeId: 'execution_plan', status: 'completed', value: {
      productionStrategy: 'compose_assets', selectedAssetRefs: [], assetRoles: [], renderRoute: 'fixture',
      candidateCount: task.deliverySpec.outputCount, layerPlan: [], estimatedCost: { currency: 'CNY', amount: 0 },
      estimatedDurationSeconds: 10, fallbackRoutes: [], unmetCriteria: [],
    }, inputRefs: [], createdBy: { kind: 'agent', id: 'fixture_planner' }, now });
  return recordSocialImageNodeOutput({ store, tenantId: 'tenant-a', taskId: task.id,
    expectedVersion: execution.version, nodeId: 'render_spec', status: 'completed', value: {
      width: 1200, height: 1500, aspectRatio: '4:5', assetInputs: [], layoutConstraints: {}, textLayers: [],
      subjectConstraints: [], factorTargets: [], negativeConstraints: [], providerAdapterVersion: 'fixture',
      seedPolicy: 'fixed', idempotencyKey: 'fixture-render-spec', inputHash: 'b'.repeat(64),
    }, inputRefs: [], createdBy: { kind: 'worker', id: 'fixture_renderer' }, now });
}

async function authorizedFormalRun(imageType: 'product_poster' | 'carousel' = 'product_poster') {
  const { store, now } = await fixture();
  let task = (await createOrResumeBoundSocialImageRun(store, 'tenant-a', {
    contentTaskId: 'content-a', expectedContentTaskVersion: '7', idempotencyKey: `formal-${imageType}`,
    entrySource: 'workspace', imageType,
  }, now)).task;
  if (imageType === 'carousel') {
    const changed = await updateSocialImageTask(store, 'tenant-a', task.id, task.version, {
      deliverySpec: { ...task.deliverySpec, outputCount: 4, format: 'carousel' },
    });
    assert.equal(changed.kind, 'updated');
    if (changed.kind !== 'updated') throw new Error('fixture_delivery_update_failed');
    task = changed.task;
  }
  task = await recordSocialImageBusinessContext({ store, tenantId: 'tenant-a', taskId: task.id, expectedVersion: task.version });
  const bytes = await sharp({ create: { width: 40, height: 50, channels: 4, background: '#f0d8c0' } }).png().toBuffer();
  const imageHash = createHash('sha256').update(bytes).digest('hex');
  const authorized = socialImageAssetAuthorization({ tenantId: 'tenant-a', scope: 'own', rightsStatus: 'owned',
    rightsEvidenceRef: 'license:product-a', commercialUseApproved: true, derivativesApproved: true,
    modelInputAllowed: true }, 'tenant-a');
  assert.ok(authorized);
  const asset = await inspectSocialImageAsset({ assetId: 'product-a', role: 'product', required: true,
    bytes, mimeType: 'image/png', expectedContentHash: imageHash, authorization: authorized });
  assert.equal(asset.rights, 'cleared');
  task = await recordSocialImageNodeOutput({ store, tenantId: 'tenant-a', taskId: task.id, expectedVersion: task.version,
    nodeId: 'asset_manifest', status: 'completed', value: socialImageAssetManifest({ assets: [asset], ocrAvailable: false }),
    inputRefs: [], evidenceRefs: [{ objectType: 'enterprise-image-asset', id: 'product-a', version: 1, contentHash: imageHash }],
    createdBy: { kind: 'worker', id: 'authorized_asset_probe' }, now });
  return { store, task, imageHash };
}

async function serverDirector(store: MemoryStore, task: SocialImageCreationTask, provenance = 'ai') {
  return recordSocialImageV3DirectorBrief({ store, tenantId: 'tenant-a', taskId: task.id, expectedVersion: task.version,
    result: { poster: normalizePosterBrief({ headline: '低敏产品方案', subheadline: '面向品牌采购', cta: '了解产品' }),
      caption: '基于企业产品资料的产品展示', hashtags: ['#产品'], fieldsToConfirm: [], provenance } });
}

test('authorized V3 single image reaches queue and atomic claim through server-produced formal nodes', async () => {
  const { store, task: evidenced } = await authorizedFormalRun();
  const planned = await serverDirector(store, evidenced);
  assert.equal(socialImageV3PaidPrerequisiteIssue(planned, 'queue'), null);
  const compiled = await compileSocialImageV3PaidPlan({ store, tenantId: 'tenant-a', taskId: planned.id,
    expectedVersion: planned.version });
  assert.equal(socialImageV3PaidPrerequisiteIssue(compiled, 'execute'), null);
  assert.equal(compiled.layerGraph, undefined, 'formal single-image plan does not require a fake layer graph');
  const renderSpec = compiled.productionRuntime!.nodeOutputs.filter(item => item.nodeId === 'render_spec').at(-1)!.value as { idempotencyKey: string };
  const now = new Date().toISOString();
  const patch = await admitSocialImageV3QueuedJob(store, 'tenant-a', compiled, { status: 'generating', step: 'generate', generationJobs: [
    ...compiled.generationJobs, { id: 'single-1', idempotencyKey: renderSpec.idempotencyKey,
      status: 'queued', outputNodeIds: [], attempt: 0, createdAt: now, updatedAt: now },
  ] });
  const queued = await updateSocialImageTask(store, 'tenant-a', compiled.id, compiled.version, patch);
  assert.equal(queued.kind, 'updated');
  if (queued.kind !== 'updated') return;
  assert.equal(socialImageV3SingleRenderInput(queued.task, 'single-1')?.idempotencyKey, renderSpec.idempotencyKey);
  const claimed = await claimSocialImagePaidJob({ store, tenantId: 'tenant-a', taskId: compiled.id, jobId: 'single-1',
    idempotencyKey: renderSpec.idempotencyKey, inputHash: 'a'.repeat(64) });
  assert.equal(claimed.generationJobs.at(-1)?.status, 'running');
});

test('bound run freezes a hashed task context and rejects snapshot mutation before paid work', async () => {
  const { store, now } = await fixture();
  const task = (await createOrResumeBoundSocialImageRun(store, 'tenant-a', {
    contentTaskId:'content-a', expectedContentTaskVersion:'7', idempotencyKey:'snapshot-check',
    entrySource:'assistant', imageType:'product_poster',
  }, now)).task;
  const snapshot = task.productionRuntime?.binding?.taskContextSnapshot;
  assert.equal(snapshot?.schemaVersion, 'task-context-snapshot.v1');
  assert.equal(snapshot?.snapshotVersion, 7);
  assert.equal(snapshot?.productIds[0], 'product-a');
  assert.equal(snapshot?.audience, '品牌采购');
  assert.match(snapshot?.contentHash || '', /^[a-f0-9]{64}$/);
  const changed = structuredClone(task);
  if (!changed.productionRuntime?.binding) throw new Error('fixture_binding_missing');
  changed.productionRuntime.binding.taskContextSnapshot.audience = '被篡改的受众';
  assert.equal(socialImageV3PaidPrerequisiteIssue(changed, 'queue'), 'social_image_task_context_snapshot_invalid');
});

test('a changed canonical ContentTask invalidates a prepared image before paid planning or queue admission', async () => {
  const { store, task: evidenced } = await authorizedFormalRun();
  const director = await serverDirector(store, evidenced);
  const row = await store.getById<Record_>(STARTER_COLLECTIONS.socialContentTasks, 'content-row');
  assert.ok(row);
  await store.update(STARTER_COLLECTIONS.socialContentTasks, 'content-row', { version: '8',
    brief: { ...(row.brief as Record<string, unknown>), objective: '已经修改的采购目标' } });
  await assert.rejects(compileSocialImageV3PaidPlan({ store, tenantId: 'tenant-a', taskId: director.id,
    expectedVersion: director.version }), /social_image_content_task_binding_stale/);
});

test('a paid claim continues from its frozen snapshot after the mutable task later changes', async () => {
  const { store, task: evidenced } = await authorizedFormalRun();
  const planned = await serverDirector(store, evidenced);
  const compiled = await compileSocialImageV3PaidPlan({ store, tenantId:'tenant-a', taskId:planned.id,
    expectedVersion:planned.version });
  const renderSpec = compiled.productionRuntime!.nodeOutputs.filter(item => item.nodeId === 'render_spec').at(-1)!.value as {idempotencyKey:string};
  const now = new Date().toISOString();
  const patch = await admitSocialImageV3QueuedJob(store, 'tenant-a', compiled, { status:'generating', step:'generate',
    generationJobs:[...compiled.generationJobs, { id:'frozen-job', idempotencyKey:renderSpec.idempotencyKey,
      status:'queued', outputNodeIds:[], attempt:0, createdAt:now, updatedAt:now }] });
  const queued = await updateSocialImageTask(store, 'tenant-a', compiled.id, compiled.version, patch);
  if (queued.kind !== 'updated') throw new Error('fixture_queue_failed');
  const claimed = await claimSocialImagePaidJob({ store, tenantId:'tenant-a', taskId:queued.task.id, jobId:'frozen-job',
    idempotencyKey:renderSpec.idempotencyKey, inputHash:'9'.repeat(64) });
  if (!claimed.productionRuntime?.binding) throw new Error('fixture_binding_missing');
  const before = structuredClone(claimed.productionRuntime.binding.taskContextSnapshot);
  const row = await store.getById<Record_>(STARTER_COLLECTIONS.socialContentTasks, 'content-row');
  assert.ok(row);
  await store.update(STARTER_COLLECTIONS.socialContentTasks, 'content-row', { version:'8',
    brief:{ ...(row.brief as Record<string, unknown>), objective:'付费后修改的新目标' } });
  await assert.doesNotReject(assertSocialImageCurrentContentTask(store, 'tenant-a', claimed));
  assert.deepEqual(claimed.productionRuntime.binding.taskContextSnapshot, before);
});

test('single-image targeted repair gets a new formal render-spec and receipt key without erasing the prior output', async () => {
  const { store, task: evidenced } = await authorizedFormalRun();
  const director = await serverDirector(store, evidenced);
  const firstPlan = await compileSocialImageV3PaidPlan({ store, tenantId: 'tenant-a', taskId: director.id,
    expectedVersion: director.version });
  const firstKey = (firstPlan.productionRuntime!.nodeOutputs.filter(item => item.nodeId === 'render_spec').at(-1)!.value as
    { idempotencyKey: string }).idempotencyKey;
  const now = new Date().toISOString();
  const firstPatch = await admitSocialImageV3QueuedJob(store, 'tenant-a', firstPlan, { status: 'generating', step: 'generate',
    generationJobs: [{ id: 'original-job', idempotencyKey: firstKey, status: 'queued', outputNodeIds: [], attempt: 0,
      createdAt: now, updatedAt: now }] });
  const firstQueue = await updateSocialImageTask(store, 'tenant-a', firstPlan.id, firstPlan.version, firstPatch);
  if (firstQueue.kind !== 'updated') throw new Error('fixture_queue_failed');
  await claimSocialImagePaidJob({ store, tenantId: 'tenant-a', taskId: firstPlan.id, jobId: 'original-job',
    idempotencyKey: firstKey, inputHash: 'c'.repeat(64) });
  const completed = await completeSocialImagePaidJob({ store, tenantId: 'tenant-a', taskId: firstPlan.id,
    jobId: 'original-job', inputHash: 'c'.repeat(64), provider: 'mock', output: {
      id: 'original-output', role: 'single', label: '首版', state: 'quality_checking', version: 1,
      materialId: 'material-original', mediaUrl: '/media/original.png', qualityChecks: [],
    } });
  const repair = await updateSocialImageTask(store, 'tenant-a', completed.id, completed.version, {
    status: 'planned', step: 'generate', repairInstructions: [{ id: 'repair-1', outputNodeId: 'original-output',
      failedChecks: ['safe_zone'], targetLayer: 'background', instruction: '产品不要遮挡标题', status: 'pending', fromVersion: 1 }],
    outputs: completed.outputs.map(output => ({ ...output, state: 'repair_required' as const })),
  });
  if (repair.kind !== 'updated') throw new Error('fixture_repair_failed');
  assert.equal(socialImageV3PaidPrerequisiteIssue(repair.task, 'execute'), 'social_image_render_spec_stale');
  const revised = await compileSocialImageV3PaidPlan({ store, tenantId: 'tenant-a', taskId: completed.id,
    expectedVersion: repair.task.version });
  const nextKey = (revised.productionRuntime!.nodeOutputs.filter(item => item.nodeId === 'render_spec').at(-1)!.value as
    { idempotencyKey: string }).idempotencyKey;
  assert.notEqual(nextKey, firstKey);
  assert.equal(revised.generationJobs[0]?.idempotencyKey, firstKey);
  const nextPatch = await admitSocialImageV3QueuedJob(store, 'tenant-a', revised, { status: 'generating', step: 'generate',
    generationJobs: [...revised.generationJobs, { id: 'repair-job', idempotencyKey: nextKey,
      status: 'queued', outputNodeIds: [], attempt: 0, createdAt: now, updatedAt: now }] });
  const nextQueue = await updateSocialImageTask(store, 'tenant-a', revised.id, revised.version, nextPatch);
  if (nextQueue.kind !== 'updated') throw new Error('fixture_repair_queue_failed');
  assert.match(socialImageV3SingleRenderInput(nextQueue.task, 'repair-job')?.imagePrompt || '', /Targeted repair/);
  const claimed = await claimSocialImagePaidJob({ store, tenantId: 'tenant-a', taskId: revised.id,
    jobId: 'repair-job', idempotencyKey: nextKey, inputHash: 'd'.repeat(64) });
  assert.equal(claimed.generationJobs[0]?.outputNodeIds[0], 'original-output');
  assert.equal(claimed.generationJobs[1]?.status, 'running');
});

test('authorized V3 carousel freezes all units, writes the formal plan, and claims only its first unit', async () => {
  const { store, task: evidenced, imageHash } = await authorizedFormalRun('carousel');
  const planned = await serverDirector(store, evidenced);
  await assert.rejects(persistSocialImageMultiUnitPlan({ store, tenantId: 'tenant-a', taskId: planned.id,
    expectedVersion: planned.version, productHashes: { 'product-a': 'd'.repeat(64) } }), /required_asset_bytes_changed/);
  assert.equal((await readSocialImageTask(store, 'tenant-a', planned.id))?.renderPlan, undefined,
    'changed product bytes must not leave queued paid units or a frozen plan behind');
  const frozen = await persistSocialImageMultiUnitPlan({ store, tenantId: 'tenant-a', taskId: planned.id,
    expectedVersion: planned.version, productHashes: { 'product-a': imageHash } });
  assert.equal(frozen.renderPlan?.units.length, 4);
  const replay = await persistSocialImageMultiUnitPlan({ store, tenantId: 'tenant-a', taskId: planned.id,
    expectedVersion: planned.version, productHashes: { 'product-a': imageHash } });
  assert.equal(replay.version, frozen.version, 'identical stale retry returns the same frozen plan without a second write');
  const compiled = await compileSocialImageV3PaidPlan({ store, tenantId: 'tenant-a', taskId: frozen.id,
    expectedVersion: frozen.version });
  assert.equal(socialImageV3PaidPrerequisiteIssue(compiled, 'execute'), null);
  const first = compiled.renderPlan!.units[0]!;
  const request = socialImagePlannedRenderInput(compiled, first.jobId);
  assert.equal(request.idempotencyKey, first.idempotencyKey);
  const claimed = await claimSocialImagePlannedUnit({ store, tenantId: 'tenant-a', taskId: compiled.id,
    jobId: first.jobId, idempotencyKey: first.idempotencyKey, plannedInputHash: first.plannedInputHash,
    renderRequestHash: 'b'.repeat(64) });
  assert.equal(claimed.generationJobs.find(job => job.id === first.jobId)?.status, 'running');
  await assert.rejects(claimSocialImagePlannedUnit({ store, tenantId: 'tenant-a', taskId: compiled.id,
    jobId: compiled.renderPlan!.units[1]!.jobId, idempotencyKey: compiled.renderPlan!.units[1]!.idempotencyKey,
    plannedInputHash: compiled.renderPlan!.units[1]!.plannedInputHash, renderRequestHash: 'c'.repeat(64) }), /prior_paid_job_unresolved/);
});

test('missing evidence, fallback planner, stale inputs and stale versions never reach V3 paid claim', async () => {
  const { store, task: evidenced } = await authorizedFormalRun();
  await assert.rejects(compileSocialImageV3PaidPlan({ store, tenantId: 'tenant-a', taskId: evidenced.id,
    expectedVersion: evidenced.version }), /director_brief_required/);
  const fallback = await serverDirector(store, evidenced, 'deterministic_fallback');
  assert.equal(fallback.productionRuntime?.nodes.find(node => node.nodeId === 'director_brief')?.status, 'needs_review');
  await assert.rejects(compileSocialImageV3PaidPlan({ store, tenantId: 'tenant-a', taskId: fallback.id,
    expectedVersion: fallback.version }), /director_brief_required/);
  const director = await serverDirector(store, fallback);
  const compiled = await compileSocialImageV3PaidPlan({ store, tenantId: 'tenant-a', taskId: director.id,
    expectedVersion: director.version });
  await assert.rejects(compileSocialImageV3PaidPlan({ store, tenantId: 'tenant-a', taskId: compiled.id,
    expectedVersion: director.version }), /version_conflict/);
  const changed = await updateSocialImageTask(store, 'tenant-a', compiled.id, compiled.version, {
    imageTextContract: { ...compiled.imageTextContract, headline: '被改动的标题' },
  });
  assert.equal(changed.kind, 'updated');
  if (changed.kind === 'updated') {
    assert.equal(socialImageV3PaidPrerequisiteIssue(changed.task, 'execute'), 'social_image_director_brief_stale');
    const replanned = await serverDirector(store, changed.task);
    assert.equal(socialImageV3PaidPrerequisiteIssue(replanned, 'queue'), null,
      'the stale plan must be replaceable through the server planner before any paid work');
  }
});

test('an unlicensed product image and a legacy task cannot acquire a formal paid plan', async () => {
  const { store, now } = await fixture();
  const created = (await createOrResumeBoundSocialImageRun(store, 'tenant-a', {
    contentTaskId: 'content-a', expectedContentTaskVersion: '7', idempotencyKey: 'formal-unlicensed',
    entrySource: 'workspace', imageType: 'product_poster',
  }, now)).task;
  const business = await recordSocialImageBusinessContext({ store, tenantId: 'tenant-a', taskId: created.id,
    expectedVersion: created.version });
  const bytes = await sharp({ create: { width: 40, height: 50, channels: 4, background: '#eeeeee' } }).png().toBuffer();
  const asset = await inspectSocialImageAsset({ assetId: 'product-a', role: 'product', required: true,
    bytes, mimeType: 'image/png', authorization: socialImageAssetAuthorization({ tenantId: 'tenant-a',
      rightsStatus: 'unknown', rightsEvidenceRef: 'pending', commercialUseApproved: true,
      derivativesApproved: true, modelInputAllowed: true }, 'tenant-a') });
  assert.notEqual(asset.rights, 'cleared');
  await assert.rejects(recordSocialImageNodeOutput({ store, tenantId: 'tenant-a', taskId: business.id,
    expectedVersion: business.version, nodeId: 'asset_manifest', status: 'completed',
    value: socialImageAssetManifest({ assets: [asset], ocrAvailable: false }), inputRefs: [],
    createdBy: { kind: 'worker', id: 'unauthorized_asset_probe' } }), /required_asset_evidence_invalid/);
  await assert.rejects(compileSocialImageV3PaidPlan({ store, tenantId: 'tenant-a', taskId: business.id,
    expectedVersion: business.version }), /asset_manifest_required/);
  const legacyRow = await store.getById<Record_>(SOCIAL_IMAGE_TASKS_COLLECTION, business.id);
  if (!legacyRow) throw new Error('fixture_task_missing');
  await store.update(SOCIAL_IMAGE_TASKS_COLLECTION, business.id, { spec: { ...(legacyRow.spec as Record<string, unknown>),
    socialImageTask: { ...business, schemaVersion: 'social-image-creation.v2' } } });
  await assert.rejects(compileSocialImageV3PaidPlan({ store, tenantId: 'tenant-a', taskId: business.id,
    expectedVersion: business.version }), /v3_run_required/);
});

test('ContentTask binding is deterministic, resumable and rejects changed scope', async () => {
  const { store, now } = await fixture();
  const input = { contentTaskId: 'content-a', expectedContentTaskVersion: '7', idempotencyKey: 'assistant-message-001',
    entrySource: 'assistant' as const, imageType: 'product_poster' as const };
  const first = await createOrResumeBoundSocialImageRun(store, 'tenant-a', input, now);
  assert.equal(first.resumed, false);
  assert.equal(first.task.schemaVersion, 'social-image-creation.v3');
  assert.equal(first.task.productionRuntime?.binding?.contentTaskId, 'content-a');
  assert.equal(first.task.deliverySpec.platform, 'instagram');
  assert.equal(first.task.deliverySpec.aspectRatio, '4:5');
  const replay = await createOrResumeBoundSocialImageRun(store, 'tenant-a', input, now);
  assert.equal(replay.resumed, true);
  assert.equal(replay.task.id, first.task.id);
  const workspaceReplay = await createOrResumeBoundSocialImageRun(store, 'tenant-a', {
    ...input, idempotencyKey: 'workspace-open-001', entrySource: 'workspace',
  }, now);
  assert.equal(workspaceReplay.resumed, true, 'entry source is provenance and must not fork the ContentTask child run');
  assert.equal(workspaceReplay.task.id, first.task.id);
  await assert.rejects(createOrResumeBoundSocialImageRun(store, 'tenant-a', { ...input, imageType: 'brand_news' }, now),
    /social_image_run_scope_conflict/);
  const assetReady = await recordReadyAssetManifest(store, workspaceReplay.task, now);
  const staged = await updateSocialImageTask(store, 'tenant-a', first.task.id, assetReady.version, { outputs: [{
    id: 'candidate-before-content-change', role: 'single', label: '旧业务输入候选', state: 'quality_checking', version: 1,
    qualityChecks: SOCIAL_IMAGE_HARD_CHECKS.map(key => ({ key, verdict: 'uncertain', severity: 'hard', note: '旧候选' })),
  }] });
  assert.equal(staged.kind, 'updated');
  const contentRow = await store.getById<Record_>(STARTER_COLLECTIONS.socialContentTasks, 'content-row');
  await store.update(STARTER_COLLECTIONS.socialContentTasks, 'content-row', { version: '8',
    brief: { ...(contentRow!.brief as Record<string, unknown>), objective: '更新后的统一业务主张' } });
  const refreshed = await createOrResumeBoundSocialImageRun(store, 'tenant-a', { ...input, expectedContentTaskVersion: '8' }, now);
  assert.equal(refreshed.task.productionRuntime?.binding?.contentTaskVersion, '8');
  assert.equal(refreshed.task.contentBrief.coreClaim, '更新后的统一业务主张');
  assert.equal(refreshed.task.outputs[0]?.state, 'superseded');
  const refreshedSnapshot = projectSocialImageProductionSnapshot(refreshed.task);
  assert.equal(refreshedSnapshot.currentNode, 'business_context');
  assert.equal(refreshedSnapshot.currentStatus, 'stale');
  assert.equal(refreshed.task.productionRuntime?.nodes.find(node => node.nodeId === 'reference_snapshot')?.status, 'skipped');
  assert.equal(refreshed.task.productionRuntime?.nodes.find(node => node.nodeId === 'element_inventory')?.status, 'skipped');
  assert.ok(!refreshed.task.productionRuntime?.nodeOutputs.some(output =>
    ['reference_snapshot', 'element_inventory', 'hook_factors', 'adaptation'].includes(output.nodeId) && output.status === 'stale'));
  await assert.rejects(createOrResumeBoundSocialImageRun(store, 'tenant-b', input, now), /social_image_content_task_not_found/);
});

test('V3 runtime does not infer formal production readiness from mutable task fields', async () => {
  const { store, now } = await fixture();
  const created = (await createOrResumeBoundSocialImageRun(store, 'tenant-a', {
    contentTaskId: 'content-a', expectedContentTaskVersion: '7', idempotencyKey: 'runtime-formal-only', entrySource: 'workspace',
  }, now)).task;
  assert.equal(projectSocialImageProductionSnapshot(created).currentNode, 'business_context');
  const assetReady = await recordReadyAssetManifest(store, created, now);
  const misleading = await updateSocialImageTask(store, 'tenant-a', created.id, assetReady.version, {
    renderBrief: { headline: '仅草稿', subheadline: '', originBadge: '', trustBadges: [], sellingPoints: [],
      process: [], categories: [], bottomBar: [], cta: '' },
    imageTextContract: { ...created.imageTextContract, headline: '仅草稿' },
    renderPlan: { version: 1, sourceHash: 'f'.repeat(64), createdAt: now, units: [] },
  });
  assert.equal(misleading.kind, 'updated');
  if (misleading.kind !== 'updated') return;
  assert.equal(projectSocialImageProductionSnapshot(misleading.task).currentNode, 'director_brief');
  assert.equal(projectSocialImageProductionSnapshot(misleading.task).currentStatus, 'waiting');
});

test('V3 approval requires independent review, exact bytes and explicit user evidence', async () => {
  const { store, now } = await fixture();
  const created = (await createOrResumeBoundSocialImageRun(store, 'tenant-a', {
    contentTaskId: 'content-a', expectedContentTaskVersion: '7', idempotencyKey: 'assistant-message-002', entrySource: 'assistant',
  }, now)).task;
  await assert.rejects(recordSocialImageNodeOutput({ store, tenantId: 'tenant-a', taskId: created.id, expectedVersion: created.version,
    nodeId: 'asset_manifest', status: 'completed', value: { enterpriseFactSnapshotRef: null, assets: [], requiredEvidence: [],
      missingCapabilities: [], prohibitedClaims: [] }, inputRefs: [], createdBy: { kind: 'worker', id: 'invalid_probe' }, now }),
  /social_image_required_asset_evidence_invalid/);
  const assetReady = await recordReadyAssetManifest(store, created, now);
  const productionReady = await recordReadyProductionPlan(store, assetReady, now);
  const output = { id: 'candidate-a', role: 'single' as const, label: '主视觉', state: 'quality_checking' as const,
    mediaUrl: '/api/overseas/social-images/renders/candidate.png', version: 1, contentHash: 'a'.repeat(64),
    qualityChecks: SOCIAL_IMAGE_HARD_CHECKS.map(key => ({ key, verdict: 'pass' as const, severity: 'hard' as const,
      checker: 'deterministic' as const, note: 'fixture pass' })),
  };
  const ready = await updateSocialImageTask(store, 'tenant-a', created.id, productionReady.version, {
    outputs: [output], status: 'review_required', step: 'review',
  });
  assert.equal(ready.kind, 'updated');
  if (ready.kind !== 'updated') return;
  assert.deepEqual(projectSocialImageProductionSnapshot(ready.task).previews, [{
    candidateId: output.id, candidateVersion: output.version, contentHash: output.contentHash,
    state: output.state, mediaUrl: output.mediaUrl,
  }]);
  assert.equal(ready.task.productionRuntime?.events.at(-1)?.artifactRefs?.[0]?.contentHash, output.contentHash);
  const forged = await updateSocialImageTask(store, 'tenant-a', created.id, ready.task.version, { status: 'approved' });
  assert.equal(forged.kind, 'invalid');
  const reviewed = await runSocialImageDirectorReview({ store, tenantId: 'tenant-a', taskId: created.id,
    expectedVersion: ready.task.version, candidateId: output.id, candidateVersion: output.version, now });
  assert.equal(reviewed.directorReviewDecision?.decision, 'accept_for_user_review');
  const contentHash = 'a'.repeat(64);
  const accepted = await decideSocialImageCandidate({ store, tenantId: 'tenant-a', userId: 'user-a', taskId: created.id,
    expectedVersion: reviewed.version, candidateId: output.id, candidateVersion: output.version,
    expectedContentHash: contentHash, actualContentHash: contentHash, decision: 'approved', now });
  assert.equal(accepted.task.status, 'approved');
  assert.equal(accepted.task.publishable, true);
  assert.equal(accepted.decision.source, 'explicit_user_action');
  assert.equal(accepted.task.approvedArtifact?.contentTaskId, 'content-a');
  assert.equal(projectSocialImageProductionSnapshot(accepted.task).currentNode, 'delivery');
  assert.equal((await readSocialImageTask(store, 'tenant-a', created.id))?.approvedArtifact?.contentHash, contentHash);
  const delivered = await createSocialImageDeliveryPackage({ store, tenantId: 'tenant-a', taskId: created.id,
    expectedVersion: accepted.task.version, now });
  assert.equal(delivered.deliveryPackage.status, 'ready');
  assert.equal(delivered.task.publishable, true);
  assert.equal(projectSocialImageProductionSnapshot(delivered.task).currentStatus, 'completed');
  const replayedDelivery = await createSocialImageDeliveryPackage({ store, tenantId: 'tenant-a', taskId: created.id,
    expectedVersion: delivered.task.version, now });
  assert.equal(replayedDelivery.task.version, delivered.task.version);
  assert.equal(replayedDelivery.deliveryPackage.packageId, delivered.deliveryPackage.packageId);
});

async function multiOutputFixture(imageType: 'carousel' | 'gif_poster') {
  const { store, now } = await fixture();
  const created = (await createOrResumeBoundSocialImageRun(store, 'tenant-a', {
    contentTaskId: 'content-a', expectedContentTaskVersion: '7', idempotencyKey: `multi-${imageType}-001`,
    entrySource: 'assistant', imageType,
  }, now)).task;
  assert.equal(created.deliverySpec.outputCount, 4);
  assert.equal(created.deliverySpec.format, imageType === 'carousel' ? 'carousel' : 'gif');
  const assetReady = await recordReadyAssetManifest(store, created, now);
  const productionReady = await recordReadyProductionPlan(store, assetReady, now);
  const sourceHash = 'f'.repeat(64);
  const units = Array.from({ length: 4 }, (_, index) => ({
    jobId: `job-${index}`, index, count: 4, label: imageType === 'carousel' ? `轮播第 ${index + 1} 页` : `GIF 背景 ${index + 1}`,
    role: imageType === 'carousel' ? 'carousel_page' as const : 'gif_plate' as const,
    poster: { headline: `第 ${index + 1} 页` }, idempotencyKey: `paid-unit-${index}`, plannedInputHash: `${index + 1}`.repeat(64),
  }));
  const jobs = units.map(unit => ({ id: unit.jobId, idempotencyKey: unit.idempotencyKey, planVersion: 1,
    unitIndex: unit.index, plannedInputHash: unit.plannedInputHash, status: 'completed' as const,
    outputNodeIds: [imageType === 'carousel' ? `page-${unit.index}` : `plate-${unit.index}`],
    attempt: 1, createdAt: now, updatedAt: now }));
  const passed = SOCIAL_IMAGE_HARD_CHECKS.map(key => ({ key, verdict: 'pass' as const, severity: 'hard' as const,
    checker: 'deterministic' as const, note: 'actual-byte fixture' }));
  const output = (id: string, role: SocialImageOutputNode['role'], label: string, digit: string,
    sourceJobId?: string): SocialImageOutputNode => ({ id, role, label, state: 'quality_checking', version: 1,
      materialId: `material-${id}`, mediaUrl: `/api/overseas/social-images/renders/${id}`,
      contentHash: digit.repeat(64), sourceJobId,
      qualityChecks: role === 'gif_plate' ? [] : role === 'gif_output'
        ? [...passed, { key: 'motion_mechanism_similarity', verdict: 'pass', severity: 'hard', checker: 'deterministic',
          note: 'all frames decoded', evidence: [`candidate-sha256:${digit.repeat(64)}`] }]
        : passed });
  const platesOrPages = units.map(unit => output(imageType === 'carousel' ? `page-${unit.index}` : `plate-${unit.index}`,
    unit.role, unit.label, `${unit.index + 1}`, unit.jobId));
  const frames = imageType === 'gif_poster' ? units.map(unit => output(`frame-${unit.index}`, 'gif_frame',
    `GIF 画面 ${unit.index + 1}`, `${unit.index + 5}`, unit.jobId)) : [];
  const final = imageType === 'gif_poster' ? output('gif-final', 'gif_output', 'GIF 成片', 'a') : undefined;
  const staged = await updateSocialImageTask(store, 'tenant-a', created.id, productionReady.version, {
    renderPlan: { version: 1, sourceHash, createdAt: now, units },
    generationJobs: jobs,
    outputs: [...platesOrPages, ...frames, ...(final ? [final] : [])],
    ...(final ? { gifDelivery: { planVersion: 1, sourceHash, frameOutputIds: frames.map(frame => frame.id), finalOutputId: final.id } } : {}),
    status: 'review_required', step: 'review',
  });
  assert.equal(staged.kind, 'updated');
  if (staged.kind !== 'updated') throw new Error('multi_output_fixture_failed');
  const reviewOutputs = socialImageReviewOutputs(staged.task);
  assert.equal(reviewOutputs.length, imageType === 'carousel' ? 4 : 5);
  return { store, now, task: staged.task, reviewOutputs };
}

for (const imageType of ['carousel', 'gif_poster'] as const) {
  test(`V3 ${imageType} reviews and adopts every deliverable as one immutable set`, async () => {
    const { store, now, task, reviewOutputs } = await multiOutputFixture(imageType);
    assert.equal(projectSocialImageProductionSnapshot(task).currentNode, 'director_review');
    const anchor = imageType === 'carousel' ? reviewOutputs[0]! : reviewOutputs.at(-1)!;
    await assert.rejects(runSocialImageDirectorReview({ store, tenantId: 'tenant-a', taskId: task.id,
      expectedVersion: task.version, candidateId: reviewOutputs[1]!.id,
      candidateVersion: reviewOutputs[1]!.version, now }), /social_image_review_candidate_stale/);
    const reviewed = await runSocialImageDirectorReview({ store, tenantId: 'tenant-a', taskId: task.id,
      expectedVersion: task.version, candidateId: anchor.id, candidateVersion: anchor.version, now });
    assert.equal(reviewed.directorReviewDecision?.decision, 'accept_for_user_review');
    assert.deepEqual(reviewed.directorReviewDecision?.candidateRefs?.map(ref => ref.id), reviewOutputs.map(output => output.id));
    const setHash = reviewed.directorReviewDecision!.candidateSetHash!;
    await assert.rejects(decideSocialImageCandidate({ store, tenantId: 'tenant-a', userId: 'user-a', taskId: task.id,
      expectedVersion: reviewed.version, candidateId: anchor.id, candidateVersion: anchor.version,
      expectedContentHash: anchor.contentHash!, actualContentHash: anchor.contentHash!, decision: 'approved', now }),
    /social_image_candidate_hash_conflict/);
    const accepted = await decideSocialImageCandidate({ store, tenantId: 'tenant-a', userId: 'user-a', taskId: task.id,
      expectedVersion: reviewed.version, candidateId: anchor.id, candidateVersion: anchor.version,
      expectedContentHash: setHash, actualContentHash: setHash, decision: 'approved', now });
    assert.equal(accepted.task.status, 'approved');
    assert.equal(accepted.task.publishable, true);
    assert.deepEqual(accepted.task.approvedArtifact?.mediaItems?.map(item => item.candidateId), reviewOutputs.map(output => output.id));
    assert.ok(reviewOutputs.every(output => accepted.task.outputs.find(item => item.id === output.id)?.state === 'approved'));
    assert.equal(socialImageTaskCanPublish({ ...accepted.task, approvedArtifact: {
      ...accepted.task.approvedArtifact!, mediaItems: accepted.task.approvedArtifact!.mediaItems!.slice(0, -1),
    } }), false, 'omitting one deliverable cannot produce a publishable package');
    if (imageType === 'gif_poster') {
      assert.ok(accepted.task.outputs.filter(output => output.role === 'gif_plate').every(output => output.state === 'quality_checking'));
    }
    const delivered = await createSocialImageDeliveryPackage({ store, tenantId: 'tenant-a', taskId: task.id,
      expectedVersion: accepted.task.version, now });
    const publishItems = imageType === 'gif_poster' ? [reviewOutputs.at(-1)!] : reviewOutputs;
    assert.equal(delivered.deliveryPackage.platformVariant.mediaItems?.length, publishItems.length);
    assert.deepEqual(delivered.deliveryPackage.platformVariant.mediaItems?.map(item => item.candidateId), publishItems.map(output => output.id));
  });
}

test('multi-output review remains blocked on one failed page and rejection retires whole set', async () => {
  const { store, now, task, reviewOutputs } = await multiOutputFixture('carousel');
  const failed = await updateSocialImageTask(store, 'tenant-a', task.id, task.version, { outputs: task.outputs.map(output =>
    output.id === reviewOutputs[3]!.id ? { ...output, qualityChecks: output.qualityChecks.map(check => check.key === 'safe_zone'
      ? { ...check, verdict: 'fail' as const } : check) } : output) });
  assert.equal(failed.kind, 'updated');
  if (failed.kind !== 'updated') return;
  await assert.rejects(runSocialImageDirectorReview({ store, tenantId: 'tenant-a', taskId: task.id,
    expectedVersion: failed.task.version, candidateId: reviewOutputs[0]!.id, candidateVersion: 1, now }),
  /social_image_director_review_not_ready/);
  const repaired = await updateSocialImageTask(store, 'tenant-a', task.id, failed.task.version, { outputs: task.outputs });
  assert.equal(repaired.kind, 'updated');
  if (repaired.kind !== 'updated') return;
  const reviewed = await runSocialImageDirectorReview({ store, tenantId: 'tenant-a', taskId: task.id,
    expectedVersion: repaired.task.version, candidateId: reviewOutputs[0]!.id, candidateVersion: 1, now });
  const rejected = await decideSocialImageCandidate({ store, tenantId: 'tenant-a', userId: 'user-a', taskId: task.id,
    expectedVersion: reviewed.version, candidateId: reviewOutputs[0]!.id, candidateVersion: 1,
    expectedContentHash: reviewed.directorReviewDecision!.candidateSetHash!,
    actualContentHash: reviewed.directorReviewDecision!.candidateSetHash!, decision: 'rejected', now });
  assert.ok(rejected.task.outputs.filter(output => output.role === 'carousel_page').every(output => output.state === 'repair_required'));
  assert.equal(projectSocialImageProductionSnapshot(rejected.task).currentNode, 'quality_check');
  await assert.rejects(decideSocialImageCandidate({ store, tenantId: 'tenant-a', userId: 'user-a', taskId: task.id,
    expectedVersion: rejected.task.version, candidateId: reviewOutputs[0]!.id, candidateVersion: 1,
    expectedContentHash: reviewed.directorReviewDecision!.candidateSetHash!,
    actualContentHash: reviewed.directorReviewDecision!.candidateSetHash!, decision: 'approved', now }),
  /social_image_hard_quality_gate_incomplete/);
});

test('explicit rejection may request repair before hard quality or director approval', async () => {
  const { store, now } = await fixture();
  const created = (await createOrResumeBoundSocialImageRun(store, 'tenant-a', {
    contentTaskId: 'content-a', expectedContentTaskVersion: '7', idempotencyKey: 'assistant-message-reject', entrySource: 'assistant',
  }, now)).task;
  const output = { id: 'candidate-reject', role: 'single' as const, label: '待修改主视觉', state: 'quality_checking' as const,
    mediaUrl: '/api/overseas/social-images/renders/reject.png', version: 1,
    qualityChecks: SOCIAL_IMAGE_HARD_CHECKS.map(key => ({ key, verdict: 'uncertain' as const, severity: 'hard' as const,
      checker: 'deterministic' as const, note: '尚未完成检查' })),
  };
  const staged = await updateSocialImageTask(store, 'tenant-a', created.id, created.version, {
    outputs: [output], status: 'review_required', step: 'review',
  });
  assert.equal(staged.kind, 'updated');
  if (staged.kind !== 'updated') return;
  const rejected = await decideSocialImageCandidate({ store, tenantId: 'tenant-a', userId: 'user-a', taskId: created.id,
    expectedVersion: staged.task.version, candidateId: output.id, candidateVersion: output.version,
    expectedContentHash: 'c'.repeat(64), actualContentHash: 'c'.repeat(64), decision: 'rejected', note: '产品主体过小', now });
  assert.equal(rejected.task.outputs[0]?.state, 'repair_required');
  assert.equal(rejected.task.status, 'review_required');
  assert.equal(rejected.task.approvalDecisions?.at(-1)?.decision, 'rejected');
  assert.equal(rejected.task.approvedArtifact, undefined);
});

test('formal node outputs survive restart and stale their downstream evidence', async () => {
  const { store, now } = await fixture();
  const created = (await createOrResumeBoundSocialImageRun(store, 'tenant-a', {
    contentTaskId: 'content-a', expectedContentTaskVersion: '7', idempotencyKey: 'assistant-message-003', entrySource: 'assistant',
  }, now)).task;
  const assetReady = await recordReadyAssetManifest(store, created, now);
  const directorValue = (headline: string) => ({ objective: '产品认知', singleCoreClaim: headline, headline, supportingText: '',
    caption: '', cta: '', requiredFacts: [], prohibitedInferences: [], visualMustShow: ['产品 A'], visualMustNotImply: [],
    compositionIntent: '产品居中', imageTextRelation: 'image_contextualizes_copy', visualProof: 'product_hero',
    brandAndOriginalityRules: [], acceptanceCriteria: [{ criterionId: 'product', observableTarget: '产品清晰', validator: 'human_review' }],
    factorSpecRef: null, adaptationSpecRef: null });
  const director = await recordSocialImageNodeOutput({ store, tenantId: 'tenant-a', taskId: created.id,
    expectedVersion: assetReady.version, nodeId: 'director_brief', status: 'completed',
    value: directorValue('第一版主张'), inputRefs: [], createdBy: { kind: 'agent', id: 'image_director' },
    taskPatch: { step: 'plan', renderBrief: { headline: '第一版主张', subheadline: '', originBadge: '', trustBadges: [],
      sellingPoints: [], process: [], categories: [], bottomBar: [], cta: '' },
    imageTextContract: { ...created.imageTextContract, headline: '第一版主张' } }, now });
  const planned = await recordSocialImageNodeOutput({ store, tenantId: 'tenant-a', taskId: created.id,
    expectedVersion: director.version, nodeId: 'execution_plan', status: 'completed', value: {
      productionStrategy: 'compose_assets', selectedAssetRefs: [], assetRoles: [], renderRoute: 'layered_compositor',
      candidateCount: 1, layerPlan: [], estimatedCost: { currency: 'CNY', amount: 0 }, estimatedDurationSeconds: 10,
      fallbackRoutes: [], unmetCriteria: [],
    },
    inputRefs: [{ objectType: 'social-image-node-envelope.v1', id: director.productionRuntime!.nodeOutputs.at(-1)!.id,
      version: 1, contentHash: director.productionRuntime!.nodeOutputs.at(-1)!.contentHash }],
    createdBy: { kind: 'agent', id: 'content_agent' }, now });
  const candidate = { id: 'candidate-before-director-change', role: 'single' as const, label: '旧方案候选',
    state: 'quality_checking' as const, version: 1, contentHash: 'd'.repeat(64),
    qualityChecks: SOCIAL_IMAGE_HARD_CHECKS.map(key => ({ key, verdict: 'pass' as const, severity: 'hard' as const,
      checker: 'deterministic' as const, note: 'fixture pass' })) };
  const withCandidate = await updateSocialImageTask(store, 'tenant-a', created.id, planned.version, {
    outputs: [candidate], status: 'review_required', step: 'review',
  });
  assert.equal(withCandidate.kind, 'updated');
  if (withCandidate.kind !== 'updated') return;
  const withReview = await recordSocialImageDirectorReview({ store, tenantId: 'tenant-a', taskId: created.id,
    expectedVersion: withCandidate.task.version, decision: { schemaVersion: 'social-image-director-review.v1',
      decision: 'accept_for_user_review', candidateId: candidate.id, candidateVersion: candidate.version,
      passedCriteria: ['旧方案'], failedCriteria: [], factorResults: [], problemRegions: [], reasonCodes: [],
      repairInstructions: [], reviewConfidence: .9, reviewedAt: now } });
  const revised = await recordSocialImageNodeOutput({ store, tenantId: 'tenant-a', taskId: created.id,
    expectedVersion: withReview.version, nodeId: 'director_brief', status: 'completed', value: directorValue('第二版主张'),
    inputRefs: [], createdBy: { kind: 'agent', id: 'image_director' },
    taskPatch: { step: 'plan', renderBrief: { headline: '第二版主张', subheadline: '', originBadge: '', trustBadges: [],
      sellingPoints: [], process: [], categories: [], bottomBar: [], cta: '' },
    imageTextContract: { ...planned.imageTextContract, headline: '第二版主张' } }, now });
  assert.equal(revised.productionRuntime?.nodeOutputs.filter(output => output.nodeId === 'execution_plan').at(-1)?.status, 'stale');
  assert.equal(revised.outputs[0]?.state, 'superseded', 'an upstream plan revision must retire the old candidate');
  assert.equal(revised.directorReviewDecision, undefined, 'an upstream plan revision must retire the old director decision');
  assert.equal(projectSocialImageProductionSnapshot(revised).currentNode, 'execution_plan');
  assert.equal(projectSocialImageProductionSnapshot(revised).currentStatus, 'stale');
  const restarted = new MemoryStore();
  for (const [collection, rows] of store.rows) restarted.rows.set(collection, structuredClone(rows));
  const recovered = await readSocialImageTask(restarted, 'tenant-a', created.id);
  assert.ok(recovered);
  assert.equal(projectSocialImageProductionSnapshot(recovered!).currentStatus, 'stale');
  assert.equal(recovered?.productionRuntime?.events.at(-1)?.nodeId, 'execution_plan');
});

test('hook factors are evidence-bound, capped at five and the fifth must be independent', () => {
  const ref = { objectType: 'image_region', id: 'region-a', version: 1, contentHash: 'b'.repeat(64) };
  const factor = (rank: 1 | 2 | 3 | 4 | 5) => ({ factorId: `factor-${rank}`, regionRefs: ['region-a'], priorityRank: rank,
    category: 'visual', observableDescription: `observable ${rank}`, causalRole: 'attention' as const, importance: 'high' as const,
    evidenceRefs: [ref], analysisConfidence: .8, causalConfidence: .4, effectStatus: 'visual_hypothesis' as const,
    transferability: 'high' as const, validator: { kind: 'saliency_order' as const, observableTarget: 'first fixation' } });
  const invalid: SocialImageHookFactorSpec = { schemaVersion: 'social-image-hook-factor-spec.v1',
    factors: [factor(1), factor(2), factor(3), factor(4), factor(5)], ordinaryVisualNotes: [], evidenceGaps: [] };
  assert.ok(socialImageHookFactorIssues(invalid).includes('social_image_hook_fifth_not_independent'));
  invalid.factors[4] = { ...invalid.factors[4]!, causalRole: 'conversion', validator: { kind: 'human_review', observableTarget: 'CTA clarity' } };
  assert.deepEqual(socialImageHookFactorIssues(invalid), []);
  invalid.factors.push({ ...factor(5), factorId: 'factor-6' });
  assert.ok(socialImageHookFactorIssues(invalid).includes('social_image_hook_count_invalid'));
  assert.doesNotThrow(() => socialImageHookFactorIssues({
    schemaVersion: 'social-image-hook-factor-spec.v1', factors: undefined, ordinaryVisualNotes: [], evidenceGaps: undefined,
  } as unknown as SocialImageHookFactorSpec));
});
