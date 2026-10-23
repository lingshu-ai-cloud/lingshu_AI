import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { SOCIAL_WORK_PACKAGE_KINDS } from '../../shared/contracts/socialContentWorkflow.js';
import { SOCIAL_IMAGE_HARD_CHECKS, socialImageReviewOutputs, socialImageTaskCanPublish, type SocialImageCreationTask, type SocialImageOutputNode } from '../../shared/contracts/socialImageCreation.js';
import { socialImageHookFactorIssues, type SocialImageHookFactorSpec } from '../../shared/contracts/socialImageProduction.js';
import { defaultBrief } from '../starter198/socialContentTaskSupport.js';
import { STARTER_COLLECTIONS } from '../starter198/repository.js';
import { readSocialImageTask, updateSocialImageTask } from './socialImageTask.js';
import {
  createOrResumeBoundSocialImageRun,
  createSocialImageDeliveryPackage,
  decideSocialImageCandidate,
  recordSocialImageNodeOutput,
  recordSocialImageDirectorReview,
  runSocialImageDirectorReview,
} from './socialImageProductionRun.js';
import { projectSocialImageProductionSnapshot } from './socialImageProductionRuntime.js';

class MemoryStore implements DataStore {
  private sequence = 0;
  readonly rows = new Map<string, Record_[]>();
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
  const business = await recordSocialImageNodeOutput({ store, tenantId: 'tenant-a', taskId: task.id,
    expectedVersion: task.version, nodeId: 'business_context', status: 'completed', value: {
      objective: task.contentBrief.coreClaim, topicType: task.contentBrief.topicType,
      deliverableType: task.imageType === 'carousel' ? 'carousel_cover' : 'product_hero',
      productRefs: task.contentBrief.productRefs, enterpriseFactSnapshotRef: null,
      audience: task.contentBrief.audience, ownedAccountId: null, accountDraftId: null,
      platforms: [task.deliverySpec.platform], targetAction: task.contentBrief.targetAction || null, successMetrics: [],
      deliverySpec: task.deliverySpec, budgetAndDeadline: { maximumCostCny: null, dueAt: null }, fieldsToConfirm: [],
    }, inputRefs: [], createdBy: { kind: 'worker', id: 'fixture_business' }, now });
  return recordSocialImageNodeOutput({ store, tenantId: 'tenant-a', taskId: task.id, expectedVersion: business.version,
    nodeId: 'asset_manifest', status: 'completed', value: { enterpriseFactSnapshotRef: null, assets: [{
      assetId: 'product-a', version: 1, contentHash: 'e'.repeat(64), role: 'product', required: true, readable: true,
      dimensions: { width: 800, height: 1000 }, rights: 'cleared', observedSubjects: [], ocr: ['产品 A'], confidence: 1,
    }], requiredEvidence: ['product-a'], missingCapabilities: [], prohibitedClaims: [] },
    inputRefs: [], evidenceRefs: [{ objectType: 'enterprise-image-asset', id: 'product-a', version: 1, contentHash: 'e'.repeat(64) }],
    createdBy: { kind: 'worker', id: 'fixture_asset_probe' }, now });
}

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
