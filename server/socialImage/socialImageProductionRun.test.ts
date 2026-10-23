import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { SOCIAL_WORK_PACKAGE_KINDS } from '../../shared/contracts/socialContentWorkflow.js';
import { SOCIAL_IMAGE_HARD_CHECKS, type SocialImageCreationTask } from '../../shared/contracts/socialImageCreation.js';
import { socialImageHookFactorIssues, type SocialImageHookFactorSpec } from '../../shared/contracts/socialImageProduction.js';
import { defaultBrief } from '../starter198/socialContentTaskSupport.js';
import { STARTER_COLLECTIONS } from '../starter198/repository.js';
import { readSocialImageTask, SOCIAL_IMAGE_TASKS_COLLECTION, updateSocialImageTask } from './socialImageTask.js';
import {
  createOrResumeBoundSocialImageRun,
  createSocialImageDeliveryPackage,
  decideSocialImageCandidate,
  recordSocialImageNodeOutput,
  recordSocialImageDirectorReview,
  runSocialImageDirectorReview,
} from './socialImageProductionRun.js';
import { projectSocialImageProductionSnapshot } from './socialImageProductionRuntime.js';
import { compileLuxuryProductHero } from './templates/luxuryProductHero.js';
import { socialImageV3ResolvedAssetIssue } from './socialImagePaidPrerequisites.js';
import { socialImageV3PaidPrerequisiteIssue, socialImageV3SingleRenderInput } from './socialImagePaidPrerequisites.js';
import { ensureSocialImageBusinessContext } from './socialImageFormalBusinessContext.js';
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
  return { store, now };
}

async function recordReadyAssetManifest(store: DataStore, task: SocialImageCreationTask, now: string) {
  return recordSocialImageNodeOutput({ store, tenantId: 'tenant-a', taskId: task.id, expectedVersion: task.version,
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
  task = await ensureSocialImageBusinessContext({ store, tenantId: 'tenant-a', taskId: task.id, expectedVersion: task.version });
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
  const patch = await admitSocialImageV3QueuedJob(store, compiled, { status: 'generating', step: 'generate', generationJobs: [
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

test('single-image targeted repair gets a new formal render-spec and receipt key without erasing the prior output', async () => {
  const { store, task: evidenced } = await authorizedFormalRun();
  const director = await serverDirector(store, evidenced);
  const firstPlan = await compileSocialImageV3PaidPlan({ store, tenantId: 'tenant-a', taskId: director.id,
    expectedVersion: director.version });
  const firstKey = (firstPlan.productionRuntime!.nodeOutputs.filter(item => item.nodeId === 'render_spec').at(-1)!.value as
    { idempotencyKey: string }).idempotencyKey;
  const now = new Date().toISOString();
  const firstPatch = await admitSocialImageV3QueuedJob(store, firstPlan, { status: 'generating', step: 'generate',
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
  const nextPatch = await admitSocialImageV3QueuedJob(store, revised, { status: 'generating', step: 'generate',
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
  const business = await ensureSocialImageBusinessContext({ store, tenantId: 'tenant-a', taskId: created.id,
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
  assert.equal(refreshedSnapshot.currentNode, 'director_brief');
  assert.equal(refreshedSnapshot.currentStatus, 'waiting');
  assert.equal(refreshed.task.productionRuntime?.nodes.find(node => node.nodeId === 'reference_snapshot')?.status, 'skipped');
  assert.equal(refreshed.task.productionRuntime?.nodes.find(node => node.nodeId === 'element_inventory')?.status, 'skipped');
  assert.ok(!refreshed.task.productionRuntime?.nodeOutputs.some(output =>
    ['reference_snapshot', 'element_inventory', 'hook_factors', 'adaptation'].includes(output.nodeId) && output.status === 'stale'));
  await assert.rejects(createOrResumeBoundSocialImageRun(store, 'tenant-b', input, now), /social_image_content_task_not_found/);
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
  const output = { id: 'candidate-a', role: 'single' as const, label: '主视觉', state: 'quality_checking' as const,
    mediaUrl: '/api/overseas/social-images/renders/candidate.png', version: 1, contentHash: 'a'.repeat(64),
    qualityChecks: SOCIAL_IMAGE_HARD_CHECKS.map(key => ({ key, verdict: 'pass' as const, severity: 'hard' as const,
      checker: 'deterministic' as const, note: 'fixture pass' })),
  };
  const ready = await updateSocialImageTask(store, 'tenant-a', created.id, assetReady.version, {
    outputs: [output], status: 'review_required', step: 'review',
    renderBrief: { headline: '低敏产品方案', subheadline: '面向品牌采购', originBadge: '', trustBadges: [], sellingPoints: [],
      process: [], categories: [], bottomBar: [], cta: '了解产品' },
    imageTextContract: { ...created.imageTextContract, headline: '低敏产品方案', caption: '基于企业资料' },
    layerGraph: compileLuxuryProductHero({ task: { ...created, imageTextContract: { ...created.imageTextContract, headline: '低敏产品方案' } },
      productId: 'product-a', productName: '产品 A' }),
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
