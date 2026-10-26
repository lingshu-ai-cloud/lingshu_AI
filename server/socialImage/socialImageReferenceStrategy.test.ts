import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { SOCIAL_WORK_PACKAGE_KINDS } from '../../shared/contracts/socialContentWorkflow.js';
import { SOCIAL_IMAGE_HARD_CHECKS, type SocialImageCreationTask } from '../../shared/contracts/socialImageCreation.js';
import { defaultBrief } from '../starter198/socialContentTaskSupport.js';
import { STARTER_COLLECTIONS } from '../starter198/repository.js';
import { analyzeSocialImageReference, inspectSocialImageAsset, socialImageAssetAuthorization } from './socialImageEvidenceWorker.js';
import { createOrResumeBoundSocialImageRun, recordSocialImageBusinessContext,
  recordSocialImageDirectorReview, recordSocialImageNodeOutput, runSocialImageDirectorReview } from './socialImageProductionRun.js';
import { projectSocialImageProductionSnapshot } from './socialImageProductionRuntime.js';
import { readSocialImageTask, updateSocialImageTask } from './socialImageTask.js';
import { renderSocialImageLayerGraph } from './layerRenderer.js';
import { socialImageCandidatePixelChecks } from './socialImageQuality.js';
import { compileEvidenceGuidedSocialImage, compileSocialImageReferencePlan, deriveSocialImageReferenceStrategy,
  inspectSocialImageCandidateFactors, prepareSocialImageReferenceStrategy, socialImageFrozenGraphMatches,
  socialImageFrozenSourceIssue } from './socialImageReferenceStrategy.js';
import { socialImageV3RenderSpecInputHash } from './socialImagePaidPrerequisites.js';

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
    const row = { id, ...structuredClone(data) } as Record_;
    this.rows.set(collection, [...rows, row]);
    return row as T;
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
    const items = (this.rows.get(collection) || []).filter(row => Object.entries(query.where || {})
      .every(([key, value]) => String(row[key] ?? '') === String(value)));
    return { items: items as T[], totalItems: items.length, totalPages: items.length ? 1 : 0,
      page: query.page || 1, perPage: query.perPage || 20 };
  }
}

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const now = '2026-10-24T02:00:00.000Z';

async function referenceImage(focal: 'top_left' | 'bottom_right', background: string) {
  const grid = await sharp(Buffer.from(`<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
    <rect width="100" height="100" fill="#ffffff"/><path d="M0 0L100 100M100 0L0 100" stroke="#000000" stroke-width="24"/>
    <circle cx="50" cy="50" r="20" fill="#000000"/></svg>`)).png().toBuffer();
  const base = sharp({ create: { width: 300, height: 300, channels: 3, background } });
  return base.composite([{ input: grid, left: focal === 'top_left' ? 0 : 200,
    top: focal === 'top_left' ? 0 : 200 }]).png().toBuffer();
}

function textBox(focal: 'top_left' | 'bottom_right') {
  return focal === 'top_left'
    ? { x: .72, y: .72, width: .22, height: .09 }
    : { x: .05, y: .05, width: .22, height: .09 };
}

async function inventoryFor(bytes: Buffer, focal: 'top_left' | 'bottom_right') {
  return analyzeSocialImageReference({ bytes, mimeType: 'image/png', referenceId: `reference-${focal}`,
    ocr: async () => [{ text: 'OLD BRAND', bbox: textBox(focal), confidence: .94 }] });
}

test('two visibly different references drive distinct focal, copy and palette layouts; unsupported structure rejects', async () => {
  const left = await referenceImage('top_left', '#123358');
  const right = await referenceImage('bottom_right', '#e4ddd2');
  const task = { deliverySpec: { aspectRatio: '1:1' }, contentBrief: { coreClaim: 'New product claim' } } as SocialImageCreationTask;
  const leftInventory = await inventoryFor(left, 'top_left');
  const rightInventory = await inventoryFor(right, 'bottom_right');
  const leftStrategy = deriveSocialImageReferenceStrategy(task, leftInventory);
  assert.equal(leftStrategy.hooks.factors.length, 2);
  assert.ok(leftStrategy.hooks.factors.every(factor => factor.effectStatus === 'visual_hypothesis'
    && factor.causalConfidence < .5 && factor.evidenceRefs.length));
  assert.ok(leftStrategy.adaptation.excludedElements.includes('reference_original_pixels'));
  const leftGraph = compileEvidenceGuidedSocialImage({ task, inventory: leftInventory,
    productId: 'product-a', headline: 'New product claim', now });
  const rightGraph = compileEvidenceGuidedSocialImage({ task, inventory: rightInventory,
    productId: 'product-a', headline: 'New product claim', now });
  assert.ok(leftGraph.layers.find(layer => layer.id === 'product-hero')!.rect.x
    < rightGraph.layers.find(layer => layer.id === 'product-hero')!.rect.x);
  assert.ok(leftGraph.layers.find(layer => layer.id === 'headline')!.rect.x
    > rightGraph.layers.find(layer => layer.id === 'headline')!.rect.x);
  assert.notEqual(leftGraph.canvas.background, rightGraph.canvas.background);
  assert.equal(leftGraph.templateId, 'reference-evidence-layout-v1');
  const uniform = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#777777' } }).png().toBuffer();
  await assert.rejects(async () => compileEvidenceGuidedSocialImage({ task,
    inventory: await inventoryFor(uniform, 'top_left'), productId: 'product-a', headline: 'New product claim' }),
  /social_image_reference_structure_unsupported/);
});

test('large reference headline stays in the copy zone while the opposite visual region holds the product', async () => {
  const bytes = await referenceImage('top_left', '#dfb5c5');
  const inventory = await inventoryFor(bytes, 'top_left');
  const topLeft = inventory.regions.find(region => region.layerRole === 'top_left')!;
  const topRight = inventory.regions.find(region => region.layerRole === 'top_right')!;
  topRight.toolScores.saliency = Number(topLeft.toolScores.saliency) - .07;
  inventory.ocrBlocks = [
    { text: '|', confidence: .99, bbox: { x: .8, y: .5, width: .01, height: .05 } },
    { text: 'FACE', confidence: .95, bbox: { x: .05, y: .16, width: .12, height: .06 } },
    { text: 'PEPTIDE', confidence: .91, bbox: { x: .05, y: .05, width: .27, height: .08 } },
  ];
  const task = { deliverySpec: { aspectRatio: '1:1' } } as SocialImageCreationTask;
  const graph = compileEvidenceGuidedSocialImage({ task, inventory,
    productId: 'product-a', headline: 'Cloud Foam Cleansing Honey', now });
  assert.ok(graph.layers.find(layer => layer.id === 'headline')!.rect.x < .3);
  assert.ok(graph.layers.find(layer => layer.id === 'product-hero')!.rect.x > .5);
});

async function boundViralTask(imageType: 'product_poster' | 'carousel' = 'product_poster') {
  const store = new MemoryStore();
  await store.create(STARTER_COLLECTIONS.socialContentTasks, {
    id: 'content-row', tenant_id: 'tenant-a', task_id: 'content-a', status: 'plan_review', version: '7',
    brief: defaultBrief({ title: '产品视觉复刻', objective: '产品低敏定位', mode: 'instant',
      productId: 'product-a', productRef: '产品 A', audience: '采购', platforms: ['instagram'], languages: ['zh'],
      formats: ['social_image'], aspectRatio: '1:1', creationMode: 'viral_replication' }),
    task_mode: 'instant', theme_selection: '', script_baseline: '', director_plan: '', material_requirements: [],
    package_selection: SOCIAL_WORK_PACKAGE_KINDS.map(kind => ({ kind, packageKey: kind, version: '1', name: kind })),
    run_id: '', weekly_plan_id: '', source_count: 0, knowledge_source_count: 0, material_source_count: 0,
    artifact_count: 0, approved_artifact_count: 0, delivery_package_count: 0, publication_count: 0,
    metric_submission_count: 0, created_at: now, updated_at: now,
  });
  await store.create('tenant_profiles',{id:'profile-a',tenant_id:'tenant-a',profile:{factVersion:{id:'fixture-enterprise-v1',revision:1,contentHash:'f'.repeat(64),confirmedAt:now,confirmedBy:'owner'}}});
  const created = (await createOrResumeBoundSocialImageRun(store, 'tenant-a', {
    contentTaskId: 'content-a', expectedContentTaskVersion: '7', idempotencyKey: 'reference-offline-001',
    entrySource: 'assistant', imageType,
  }, now)).task;
  return { store, task: created };
}

async function preparedViralTask(imageType: 'product_poster' | 'carousel' = 'product_poster') {
  const referenceBytes = await referenceImage('top_left', '#123358');
  const inventory = await inventoryFor(referenceBytes, 'top_left');
  const productBytes = await sharp({ create: { width: 180, height: 260, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const { store, task: created } = await boundViralTask(imageType);
  assert.equal(created.creationPath, 'viral_replication');
  const setReference = await updateSocialImageTask(store, 'tenant-a', created.id, created.version, {
    referenceSnapshot: { sourceRecordId: 'reference-top_left', imageUrls: ['/tenant-owned/reference.png'],
      collectedAt: now, fingerprint: digest(referenceBytes) },
  });
  assert.equal(setReference.kind, 'updated');
  if (setReference.kind !== 'updated') throw new Error('reference_fixture_update_failed');
  let task = await recordSocialImageBusinessContext({ store, tenantId: 'tenant-a', taskId: created.id,
    expectedVersion: setReference.task.version, now });
  const asset = await inspectSocialImageAsset({ assetId: 'product-a', role: 'product', required: true,
    bytes: productBytes, mimeType: 'image/png', authorization: socialImageAssetAuthorization({
      id: 'product-a', tenantId: 'tenant-a', scope: 'own', rightsStatus: 'authorized',
      rightsEvidenceRef: 'license:product-a', commercialUseApproved: true,
      derivativesApproved: true, rawLibraryUseApproved: true,
    }, 'tenant-a') });
  task = await recordSocialImageNodeOutput({ store, tenantId: 'tenant-a', taskId: task.id, expectedVersion: task.version,
    nodeId: 'asset_manifest', status: 'completed', value: { enterpriseFactSnapshotRef: null,
      assets: [asset], requiredEvidence: ['product-a'], missingCapabilities: [], prohibitedClaims: [] },
    inputRefs: [], evidenceRefs: [{ objectType: 'enterprise-image-asset', id: asset.assetId,
      version: asset.version, contentHash: asset.contentHash }],
    createdBy: { kind: 'worker', id: 'offline_product_fixture' }, now });
  const referenceRef = { objectType: 'social-image-reference', id: 'reference-top_left', version: 1, contentHash: digest(referenceBytes) };
  task = await recordSocialImageNodeOutput({ store, tenantId: 'tenant-a', taskId: task.id, expectedVersion: task.version,
    nodeId: 'reference_snapshot', status: 'completed', value: { referenceId: referenceRef.id,
      sourceUrl: '/tenant-owned/reference.png', sourceRecordId: referenceRef.id, imageAssetRef: referenceRef,
      platform: null, account: null, publishedAt: null, rightsPolicy: 'structure_only', performanceEvidence: [],
      relativePerformance: null, referencePurpose: ['structure', 'visual_hook'], fingerprint: referenceRef.contentHash },
    inputRefs: [], evidenceRefs: [referenceRef], createdBy: { kind: 'worker', id: 'offline_reference_fixture' }, now });
  const snapshotNode = task.productionRuntime!.nodeOutputs.filter(node => node.nodeId === 'reference_snapshot').at(-1)!;
  task = await recordSocialImageNodeOutput({ store, tenantId: 'tenant-a', taskId: task.id, expectedVersion: task.version,
    nodeId: 'element_inventory', status: 'completed', value: inventory,
    inputRefs: [{ objectType: snapshotNode.schemaVersion, id: snapshotNode.id,
      version: snapshotNode.version, contentHash: snapshotNode.contentHash }],
    evidenceRefs: inventory.regions.map(region => region.evidenceRef),
    createdBy: { kind: 'worker', id: 'real_pixel_analysis' }, now });
  task = await prepareSocialImageReferenceStrategy({ store, tenantId: 'tenant-a', taskId: task.id,
    expectedVersion: task.version });
  assert.equal(projectSocialImageProductionSnapshot(task).currentNode, 'director_brief');
  assert.equal(task.hookFactorSpec?.factors.length, 2);
  assert.equal(task.productionRuntime?.nodeOutputs.filter(node => node.nodeId === 'hook_factors').at(-1)?.status, 'completed');
  assert.equal(task.productionRuntime?.nodeOutputs.filter(node => node.nodeId === 'adaptation').at(-1)?.status, 'completed');
  const planned = await compileSocialImageReferencePlan({ store, tenantId: 'tenant-a', taskId: task.id,
    expectedVersion: task.version, productName: '产品 A', now });
  task = planned.task;
  return { store, task, planned, productBytes, referenceBytes };
}

test('V3 offline reference evidence flows through strategy, frozen plan and per-factor director review', async () => {
  const { store, task, planned, productBytes, referenceBytes } = await preparedViralTask();
  assert.equal(projectSocialImageProductionSnapshot(task).currentNode, 'candidate_generation');
  assert.equal(socialImageFrozenGraphMatches(task), true);
  assert.equal((task.productionRuntime?.nodeOutputs.filter(node => node.nodeId === 'render_spec').at(-1)?.value as { inputHash: string }).inputHash,
    socialImageV3RenderSpecInputHash(task));
  assert.equal(socialImageFrozenSourceIssue({ task, productBytes: new Map([['product-a', productBytes]]), referenceBytes }), null);
  assert.equal(socialImageFrozenSourceIssue({ task, productBytes: new Map([['product-a', referenceBytes]]), referenceBytes }),
    'social_image_required_asset_bytes_changed');
  assert.equal(socialImageFrozenSourceIssue({ task, productBytes: new Map([['product-a', productBytes]]), referenceBytes: productBytes }),
    'social_image_reference_bytes_changed');
  const rendered = await renderSocialImageLayerGraph({ graph: planned.graph, assets: new Map([['product-a', productBytes]]) });
  const candidateHash = digest(rendered.bytes);
  const pixelChecks = await socialImageCandidatePixelChecks({ bytes: rendered.bytes, aspectRatio: task.deliverySpec.aspectRatio });
  assert.equal(pixelChecks.find(check => check.key === 'file_decode')?.verdict, 'pass');
  const factors = await inspectSocialImageCandidateFactors({ task, bytes: rendered.bytes, mimeType: rendered.mimeType });
  assert.equal(factors.length, task.hookFactorSpec?.factors.length);
  assert.ok(factors.some(check => check.verdict === 'uncertain'), 'missing candidate OCR must not pass the text factor');
  assert.ok(factors.every(check => check.evidence?.includes(`candidate-sha256:${candidateHash}`)));
  const qualityChecks = SOCIAL_IMAGE_HARD_CHECKS.map(key => ({ key, verdict: 'pass' as const,
    severity: 'hard' as const, checker: 'human' as const, note: 'offline test adapter: independently verified synthetic fixture' }));
  const withCandidate = await updateSocialImageTask(store, 'tenant-a', task.id, task.version, { outputs: [{
    id: 'offline-candidate', role: 'single', label: '离线合成图', state: 'quality_checking', version: 1,
    contentHash: candidateHash, qualityChecks: [...qualityChecks, ...factors],
  }] });
  assert.equal(withCandidate.kind, 'updated');
  if (withCandidate.kind !== 'updated') return;
  assert.equal(projectSocialImageProductionSnapshot(withCandidate.task).currentNode, 'director_review');
  const reviewed = await runSocialImageDirectorReview({ store, tenantId: 'tenant-a', taskId: task.id,
    expectedVersion: withCandidate.task.version, candidateId: 'offline-candidate', candidateVersion: 1, now });
  assert.equal(reviewed.directorReviewDecision?.decision, 'repair');
  assert.ok(reviewed.directorReviewDecision?.factorResults.some(result => result.verdict === 'uncertain'));
  assert.ok(reviewed.directorReviewDecision?.failedCriteria.includes('hook_factor:reference-text-hierarchy'));
  await assert.rejects(recordSocialImageDirectorReview({ store, tenantId: 'tenant-a', taskId: task.id,
    expectedVersion: reviewed.version, decision: { ...reviewed.directorReviewDecision!,
      decision: 'accept_for_user_review', factorResults: reviewed.directorReviewDecision!.factorResults
        .map(result => ({ ...result, verdict: 'pass' as const })) } }), /social_image_hook_candidate_evidence_incomplete/);
  const restored = await readSocialImageTask(store, 'tenant-a', task.id);
  assert.equal(restored?.directorReviewDecision?.decision, 'repair');
});

test('V3 viral carousel repairs the whole set when one page lacks factor evidence and rejects forged acceptance', async () => {
  const { store, task } = await preparedViralTask('carousel');
  assert.equal(task.deliverySpec.outputCount, 4);
  const units = Array.from({ length: 4 }, (_, index) => ({
    jobId: `viral-page-job-${index}`, index, count: 4, label: `复刻第 ${index + 1} 页`,
    role: 'carousel_page' as const, poster: { headline: `第 ${index + 1} 页` },
    idempotencyKey: `viral-page-${index}`, plannedInputHash: `${index + 1}`.repeat(64),
  }));
  const jobs = units.map(unit => ({ id: unit.jobId, idempotencyKey: unit.idempotencyKey, planVersion: 1,
    unitIndex: unit.index, plannedInputHash: unit.plannedInputHash, status: 'completed' as const,
    outputNodeIds: [`viral-page-${unit.index}`], attempt: 1, createdAt: now, updatedAt: now }));
  const outputs = units.map(unit => {
    const contentHash = `${unit.index + 1}`.repeat(64);
    return { id: `viral-page-${unit.index}`, role: 'carousel_page' as const, label: unit.label,
      state: 'quality_checking' as const, version: 1, materialId: `material-${unit.index}`,
      mediaUrl: `/api/overseas/social-images/renders/viral-page-${unit.index}`,
      sourceJobId: unit.jobId, contentHash,
      qualityChecks: [
        ...SOCIAL_IMAGE_HARD_CHECKS.map(key => ({ key, verdict: 'pass' as const, severity: 'hard' as const,
          checker: 'deterministic' as const, note: '离线像素验证通过' })),
        { key: 'reference_structure_similarity' as const, verdict: 'uncertain' as const, severity: 'soft' as const,
          checker: 'deterministic' as const, note: '参考结构仍需逐因素审查' },
        ...(task.hookFactorSpec?.factors || []).map(factor => ({ key: `hook_factor:${factor.factorId}` as const,
          verdict: unit.index === 2 && factor === task.hookFactorSpec?.factors[0] ? 'uncertain' as const : 'pass' as const,
          severity: 'soft' as const, checker: 'deterministic' as const, note: '离线候选区域证据',
          evidence: [`candidate-sha256:${contentHash}`,
            ...factor.evidenceRefs.map(ref => `reference-region-sha256:${ref.contentHash}`)],
        })),
      ],
    };
  });
  const staged = await updateSocialImageTask(store, 'tenant-a', task.id, task.version, {
    renderPlan: { version: 1, sourceHash: 'f'.repeat(64), createdAt: now, units },
    generationJobs: jobs, outputs, status: 'review_required', step: 'review',
  });
  assert.equal(staged.kind, 'updated');
  if (staged.kind !== 'updated') throw new Error('viral_carousel_fixture_update_failed');
  assert.equal(projectSocialImageProductionSnapshot(staged.task).currentNode, 'director_review');
  const reviewed = await runSocialImageDirectorReview({ store, tenantId: 'tenant-a', taskId: task.id,
    expectedVersion: staged.task.version, candidateId: outputs[0]!.id, candidateVersion: 1, now });
  assert.equal(reviewed.directorReviewDecision?.decision, 'repair');
  assert.equal(reviewed.directorReviewDecision?.candidateRefs?.length, 4);
  assert.ok(reviewed.directorReviewDecision?.failedCriteria.includes(`hook_factor:${task.hookFactorSpec!.factors[0]!.factorId}`));
  assert.equal(reviewed.directorReviewDecision?.factorResults.find(result =>
    result.factorId === task.hookFactorSpec!.factors[0]!.factorId)?.verdict, 'uncertain');
  await assert.rejects(recordSocialImageDirectorReview({ store, tenantId: 'tenant-a', taskId: task.id,
    expectedVersion: reviewed.version, decision: { ...reviewed.directorReviewDecision!,
      decision: 'accept_for_user_review', factorResults: reviewed.directorReviewDecision!.factorResults
        .map(result => ({ ...result, verdict: 'pass' as const })) } }), /social_image_hook_candidate_evidence_incomplete/);
  assert.equal((await readSocialImageTask(store, 'tenant-a', task.id))?.directorReviewDecision?.decision, 'repair');
});
