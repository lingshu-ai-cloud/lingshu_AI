import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import ffmpegStatic from 'ffmpeg-static';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { enterpriseAssetObjectKey } from '../storage/enterpriseAssets.js';
import { objectStorageUpload } from '../storage/objectStorage.js';
import { normalizeSceneVisualContract } from '../../shared/sceneVisualContract.js';
import { buildSocialWorkflowMaterialCandidates } from '../starter198/socialContentRecords.js';
import { materialRoutingRequests } from '../starter198/socialContentMaterialRoutingRequests.js';
import { readProductionProductFootageSegment } from '../starter198/socialProductFootageAdmission.js';
import { createDurableProductFootageRevisionReaders } from '../starter198/socialContentProductFootageRevisionDurableRead.js';
import { createStarter198Repository, STARTER_COLLECTIONS } from '../starter198/repository.js';
import { socialAssetSupplyPlanIdentityHash } from '../starter198/socialAssetSupplyPlanIdentity.js';
import { LangGraphTestStore } from '../../scripts/langgraphTestStore.js';
import { taskProductionAssets } from '../starter198/socialContentProductionSupport.js';
import { assetSupplyPlanWithExecutionSelections } from '../starter198/socialContentProductionExecution.js';
import { recordProductFootageApproval, recordProductFootageRevocation,
  type FootageApproval, type FootageAuthority, type FootageRevocation } from './enterpriseProductFootageReview.js';
import { readApprovedProductFootageVisualOverlay, recordProductFootageVisualFinding,
  type FootageVisualFinding } from './enterpriseProductFootageVisualReview.js';

function memory(): DataStore {
  const tables = new Map<string, Record_[]>();
  return {
    async getById<T>(table: string, id: string) { return structuredClone(tables.get(table)?.find(row => row.id === id) ?? null) as T | null; },
    async create<T>(table: string, data: Record<string, unknown>) {
      const current = tables.get(table) ?? [];
      if (current.some(row => row.id === data.id)) return null;
      const row = structuredClone(data) as Record_; tables.set(table, [...current, row]);
      return structuredClone(row) as T;
    },
    async update() { return false; }, async delete() { return false; },
    async list<T>(table: string, query: ListQuery = {}): Promise<ListResult<T>> {
      const filtered = (tables.get(table) ?? []).filter(row => Object.entries(query.where ?? {})
        .every(([key, value]) => row[key] === value));
      const page = query.page ?? 1, perPage = query.perPage ?? 30;
      return { items: structuredClone(filtered.slice((page - 1) * perPage, page * perPage)) as T[],
        totalItems: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / perPage)), page, perPage };
    },
  };
}

test('signed visual findings have a private persistent collection and append-only migration', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const migrationName = '1792195210_create_product_footage_visual_review_ledger.js';
  const migration = fs.readFileSync(path.join(root, 'pb_migrations', migrationName), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/pb-migration-checksums.json'), 'utf8'));
  const schema = fs.readFileSync(path.join(root, 'server/storage/ensureDeliveryCollections.ts'), 'utf8');
  assert.equal(manifest.migrations[migrationName], createHash('sha256').update(migration).digest('hex'));
  assert.match(migration, /name: 'social_product_footage_visual_reviews'/);
  for (const rule of ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule']) {
    assert.match(migration, new RegExp(`${rule}: null`));
  }
  for (const field of ['tenant_id', 'material_id', 'product_id', 'content_hash', 'payload']) {
    assert.ok(migration.includes(`'${field}'`));
  }
  assert.match(schema, /ensureCollection\('social_product_footage_visual_reviews'[\s\S]*?idx_product_footage_visual_product[\s\S]*?\],true\)/);
});

test('independent visual window becomes a bounded planner candidate; forged, shifted and revoked evidence does not', async () => {
  assert.ok(ffmpegStatic);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'footage-visual-review-'));
  const previous = { driver: process.env.OBJECT_STORAGE_DRIVER, root: process.env.LOCAL_OBJECT_STORAGE_ROOT,
    rightsKeys: process.env.PRODUCT_FOOTAGE_REVIEW_AUTHORITIES_JSON,
    visualKeys: process.env.PRODUCT_FOOTAGE_VISUAL_AUTHORITIES_JSON };
  process.env.OBJECT_STORAGE_DRIVER = 'local'; process.env.LOCAL_OBJECT_STORAGE_ROOT = root;
  try {
    const media = path.join(root, 'source.mp4');
    execFileSync(ffmpegStatic!, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=160x120:r=12:d=5',
      '-an', '-c:v', 'mpeg4', '-movflags', '+faststart', media]);
    const bytes = fs.readFileSync(media), sha = createHash('sha256').update(bytes).digest('hex');
    const tenantId = 'tenant-a', productId = 'product-a';
    const filename = '1792195200000-123e4567-e89b-12d3-a456-426614174000.mp4';
    const objectKey = enterpriseAssetObjectKey(tenantId, filename);
    await objectStorageUpload({ key: objectKey, body: bytes, contentType: 'video/mp4' });
    const material = { id: 'candidate-a', tenantId, productId, productRef: productId,
      name: 'candidate', scope: 'own', type: 'video', contentSha256: sha, objectKey,
      sourceUrl: `/api/overseas/enterprise/assets/${filename}`,
      provenance: { receivedAt: '2026-10-18T00:00:00.000Z', uploadedByUserId: 'uploader',
        footageCandidate: { status: 'pending_independent_review', productId,
          identityEvidenceRef: 'product-catalog:a', rightsEvidenceRef: 'license:video-a' } } };
    const keys = generateKeyPairSync('ed25519'), visualKeys = generateKeyPairSync('ed25519');
    const authorities: FootageAuthority[] = [{ keyId: 'rights-key', issuerId: 'rights-reviewer',
      publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }];
    const visualAuthorities: FootageAuthority[] = [{ keyId: 'visual-key', issuerId: 'visual-reviewer',
      publicKeyPem: visualKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }];
    process.env.PRODUCT_FOOTAGE_REVIEW_AUTHORITIES_JSON = JSON.stringify(authorities);
    process.env.PRODUCT_FOOTAGE_VISUAL_AUTHORITIES_JSON = JSON.stringify(visualAuthorities);
    const signed = <T>(statement: T, key: typeof keys.privateKey) => ({ statement,
      signatureBase64url: sign(null, Buffer.from(JSON.stringify(statement)), key).toString('base64url') });
    const reviewFile = path.join(root, 'review-store.json');
    const store = new LangGraphTestStore(reviewFile), now = new Date('2026-10-18T02:00:00.000Z');
    const approval: FootageApproval = { kind: 'product-footage-approval.v1', keyId: 'rights-key', issuerId: 'rights-reviewer',
      tenantId, productId, materialId: material.id, contentSha256: sha, objectKey,
      identityEvidenceRef: 'product-catalog:a', rightsEvidenceRef: 'license:video-a',
      rightsEvidenceSha256: 'a'.repeat(64), observedProductId: productId,
      sceneFunctions: ['value'], reviewedAt: '2026-10-18T01:00:00.000Z',
      expiresAt: '2026-10-20T00:00:00.000Z' };
    const baseApprovalId = await recordProductFootageApproval({ store, material, signed: signed(approval, keys.privateKey), authorities, now });
    const visualContract = normalizeSceneVisualContract({ subjects: ['product'],
      interaction: { kind: 'product_only_display', description: '产品包装静态展示' },
      action: { path: '产品包装静态展示' }, productId, productRef: productId, productPolicy: 'locked',
      evidence: { sourceRange: { startSeconds: 0.5, endSeconds: 2.5 } } });
    const finding: FootageVisualFinding = { kind: 'product-footage-visual.v1', keyId: 'visual-key', issuerId: 'visual-reviewer',
      tenantId, productId, materialId: material.id, contentSha256: sha, baseApprovalId,
      segmentId: 'segment-1', startMs: 500, endMs: 2500, observedProductId: productId,
      sceneFunction: 'value', visualContract, cleanEntry: true, cleanExit: true,
      reviewedAt: '2026-10-18T01:30:00.000Z', expiresAt: '2026-10-20T00:00:00.000Z' };
    const read = () => readApprovedProductFootageVisualOverlay({ store, material, tenantId, productId,
      visualAuthorities, rightsAuthorities: authorities, now });
    assert.equal(await read(), null);
    await assert.rejects(recordProductFootageVisualFinding({ store, material,
      signed: signed({ ...finding, endMs: 3500 }, visualKeys.privateKey), visualAuthorities,
      rightsAuthorities: authorities, now }), /finding_invalid/);
    await assert.rejects(recordProductFootageVisualFinding({ store, material,
      signed: signed({ ...finding, issuerId: 'uploader' }, visualKeys.privateKey), visualAuthorities,
      rightsAuthorities: authorities, now }), /finding_invalid/);
    const visualFindingId = await recordProductFootageVisualFinding({ store, material, signed: signed(finding, visualKeys.privateKey),
      visualAuthorities, rightsAuthorities: authorities, now });
    const secondVisualContract = normalizeSceneVisualContract({ subjects: ['product'],
      interaction: { kind: 'product_only_display', description: '同品另一独立展示片段' },
      action: { path: '同品另一独立展示片段' }, productId, productRef: productId, productPolicy: 'locked',
      evidence: { sourceRange: { startSeconds: 3, endSeconds: 4 } } });
    const secondFinding: FootageVisualFinding = { ...finding, segmentId: 'segment-2',
      startMs: 3000, endMs: 4000, visualContract: secondVisualContract };
    await recordProductFootageVisualFinding({ store, material, signed: signed(secondFinding, visualKeys.privateKey),
      visualAuthorities, rightsAuthorities: authorities, now });
    assert.equal(buildSocialWorkflowMaterialCandidates({ records: [{ ...material,
      scriptAnalysis: { status: 'ready', shots: [{ segmentId: 'uploader-forged' }] },
      commercialUseApproved: true }], tenantId, voiceoverRows: [], selectedProductId: productId }).candidates.length, 0);
    const overlay = await read();
    assert.ok(overlay);
    overlay.scriptAnalysis.shots.sort((left: { startSeconds: number }, right: { startSeconds: number }) =>
      left.startSeconds - right.startSeconds);
    assert.deepEqual(overlay.scriptAnalysis.shots.map((shot: { segmentId: string }) => shot.segmentId).sort(), ['segment-1', 'segment-2']);
    assert.equal(overlay.scriptAnalysis.shots[0].segmentId, 'segment-1');
    assert.deepEqual([overlay.scriptAnalysis.shots[0].startSeconds, overlay.scriptAnalysis.shots[0].endSeconds], [0.5, 2.5]);
    const candidateSet = buildSocialWorkflowMaterialCandidates({ records: [material],
      reviewedFootageOverlays: [overlay], tenantId, voiceoverRows: [], selectedProductId: productId,
      selectedProductRef: productId });
    assert.equal(candidateSet.candidates.length, 2);
    const planned = materialRoutingRequests({ policyVersion: 'type-aware.v2', tenantId, productRef: productId,
      shots: [{ shotId: 'shot-1', function: 'value', materialType: 'product',
        requestedDescription: '产品包装静态展示', plannedDurationSeconds: 1.5, visualContract }],
      candidates: candidateSet.candidates });
    assert.equal(planned[0]?.selectedMaterialSegment?.segmentId, 'segment-1');
    assert.deepEqual(planned[0]?.selectedMaterialSegment?.footageEvidence, {
      contentSha256: sha, productId, sceneFunction: 'value', approvalId: baseApprovalId, visualFindingId });
    const selected = assetSupplyPlanWithExecutionSelections({ shots: [{ shotId: 'shot-1',
      selectedMaterialSegment: planned[0]!.selectedMaterialSegment }] } as any, {
      executionPlan: { scenes: [{ sceneId: 'shot-1', selectedSourceStrategy: 'customer_real_asset',
        fallbackSourceStrategy: null, recommendedCandidateIds: ['candidate-1'], candidates: [{
          candidateId: 'candidate-1', kind: 'asset', sourceRef: material.id,
          materialSegments: [{ segmentId: 'segment-1', startSeconds: 0.5, endSeconds: 2.5,
            footageEvidence: planned[0]!.selectedMaterialSegment!.footageEvidence }],
        }] }] },
    } as any);
    assert.deepEqual(selected.shots[0]?.selectedMaterialSegment?.footageEvidence,
      planned[0]!.selectedMaterialSegment!.footageEvidence);
    const load = (selectedMaterialSegments: Array<NonNullable<NonNullable<typeof planned[0]>['selectedMaterialSegment']>> =
      [planned[0]!.selectedMaterialSegment!]) => taskProductionAssets({
      tenantId, sources: [], productRef: productId, themeId: null,
      productionMode: 'social_ready', outputDirectory: path.join(root, 'render'),
      requiredMaterialIds: [material.id], selectedMaterialSegments,
      productFootageStore: store,
      materialLibrary: async () => ({ status: 'ready' as const, items: [material], sources: [] }),
    });
    await assert.rejects(load([{ ...planned[0]!.selectedMaterialSegment!, footageEvidence: undefined }]),
      /product_footage_shot_review_required/);
    const loaded = await load();
    assert.equal(loaded.length, 1);
    assert.deepEqual(loaded[0]!.scriptAnalysis?.shots.map(shot => shot.segmentId), ['segment-1']);
    assert.equal(createHash('sha256').update(fs.readFileSync(loaded[0]!.localPath!)).digest('hex'), sha);
    const production = (changes: Record<string, unknown> = {}) => readProductionProductFootageSegment({
      store, readMaterials: async () => ({ status: 'ready' as const, items: [material] }),
      tenantId, productId, materialId: material.id, sceneFunction: 'value', segmentId: 'segment-1',
      startSeconds: 0.5, endSeconds: 2.5, expectedContentSha256: sha,
      expectedApprovalId: baseApprovalId, expectedVisualFindingId: visualFindingId,
      visualAuthorities, rightsAuthorities: authorities, now, ...changes,
    });
    assert.equal((await production())?.segmentId, 'segment-1');
    const frozenPlan: any = { planVersion: '7', shots: [{ shotId: 'shot-1',
      selectedMaterialSegment: planned[0]!.selectedMaterialSegment }] };
    await store.create(STARTER_COLLECTIONS.runs, { id: 'source-run', tenant_id: tenantId,
      status: 'failed', starter_context: { socialTaskId: 'task-1', budgetLedgerRef: 'ledger:task-1' } });
    await store.create('content_execution_jobs', { id: 'source-job', tenant_id: tenantId,
      job_key: 'source-job', task_id: 'task-1', run_id: 'source-run', user_id: 'owner',
      account_id: '_unassigned', task_type: 'social_content_weekly', status: 'blocked',
      checkpoints: { 'social.executor': { version: '1', inputHash: 'f'.repeat(64),
        payload: { inputHash: 'f'.repeat(64), approvedContext: { assetSupplyPlan: frozenPlan } },
        updatedAt: now.toISOString() } }, provider_receipts: [], provider_state: 'none' });
    const restarted = new LangGraphTestStore(reviewFile);
    const readers = createDurableProductFootageRevisionReaders({
      repository: createStarter198Repository(restarted), tenantId, taskId: 'task-1',
      sourceRunId: 'source-run', expectedSourcePlanHash: socialAssetSupplyPlanIdentityHash(frozenPlan),
      expectedBudgetLedgerRef: 'ledger:task-1',
      readMaterials: async () => ({ status: 'ready', items: [material] }),
    });
    assert.equal(socialAssetSupplyPlanIdentityHash(await readers.readCurrentPlan()),
      socialAssetSupplyPlanIdentityHash(frozenPlan));
    assert.equal(await readers.readBudgetLedgerRef(), 'ledger:task-1');
    await restarted.update('content_execution_jobs', 'source-job', { checkpoints: {
      'social.executor': { version: '1', inputHash: 'f'.repeat(64),
        payload: { inputHash: 'f'.repeat(64), approvedContext: {
          assetSupplyPlan: { ...frozenPlan, planVersion: 'other' } } }, updatedAt: now.toISOString() } } });
    await assert.rejects(readers.readCurrentPlan(), /frozen_plan_changed/);
    await restarted.update('content_execution_jobs', 'source-job', { checkpoints: {
      'social.executor': { version: '1', inputHash: 'f'.repeat(64),
        payload: { inputHash: 'f'.repeat(64), approvedContext: { assetSupplyPlan: frozenPlan } },
        updatedAt: now.toISOString() } } });
    await restarted.update(STARTER_COLLECTIONS.runs, 'source-run', {
      starter_context: { socialTaskId: 'task-1', budgetLedgerRef: 'ledger:other' } });
    await assert.rejects(readers.readBudgetLedgerRef(), /budget_ledger_identity_missing_or_changed/);
    await restarted.update(STARTER_COLLECTIONS.runs, 'source-run', {
      starter_context: { socialTaskId: 'task-1', budgetLedgerRef: 'ledger:task-1' } });
    const resumedWindow = () => readProductionProductFootageSegment({ store: restarted,
      readMaterials: readers.readMaterials, tenantId, productId, materialId: material.id,
      sceneFunction: 'value', segmentId: 'segment-1', startSeconds: 0.5, endSeconds: 2.5,
      expectedContentSha256: sha, expectedApprovalId: baseApprovalId,
      expectedVisualFindingId: visualFindingId, now });
    assert.equal((await resumedWindow())?.material.contentSha256, sha);
    const findingRow = await restarted.getById<Record<string, unknown>>(
      'social_product_footage_visual_reviews', visualFindingId);
    assert.ok(findingRow);
    await restarted.update('social_product_footage_visual_reviews', visualFindingId,
      { content_hash: '0'.repeat(64) });
    await assert.rejects(resumedWindow(), /finding_ledger_invalid/);
    await restarted.update('social_product_footage_visual_reviews', visualFindingId,
      { content_hash: findingRow.content_hash });
    assert.equal(await production({ segmentId: 'uploader-forged' }), null);
    assert.equal(await production({ startSeconds: 0.6 }), null);
    assert.equal(await production({ sceneFunction: 'hook' }), null);
    assert.equal(await production({ productId: 'product-b' }), null);
    assert.equal(await production({ expectedContentSha256: 'b'.repeat(64) }), null);
    assert.equal(await production({ expectedApprovalId: 'a'.repeat(15) }), null);
    assert.equal(await production({ expectedVisualFindingId: 'b'.repeat(15) }), null);
    assert.equal(await production({ readMaterials: async () => ({ status: 'partial', items: [material] }) }), null);
    const expiringVisualContract = normalizeSceneVisualContract({ subjects: ['product'],
      interaction: { kind: 'product_only_display', description: '短暂旧复核片段' },
      action: { path: '短暂旧复核片段' }, productId, productRef: productId, productPolicy: 'locked',
      evidence: { sourceRange: { startSeconds: 4.2, endSeconds: 4.8 } } });
    const expiredFinding: FootageVisualFinding = { ...finding, segmentId: 'expired-window',
      startMs: 4200, endMs: 4800, visualContract: expiringVisualContract,
      expiresAt: '2026-10-18T02:30:00.000Z' };
    await recordProductFootageVisualFinding({ store, material,
      signed: signed(expiredFinding, visualKeys.privateKey), visualAuthorities,
      rightsAuthorities: authorities, now });
    const renewedRead = await readApprovedProductFootageVisualOverlay({ store, material, tenantId, productId,
      visualAuthorities, rightsAuthorities: authorities, now: new Date('2026-10-18T03:00:00.000Z') });
    assert.deepEqual(renewedRead?.scriptAnalysis.shots.map((shot: { segmentId: string }) => shot.segmentId).sort(),
      ['segment-1', 'segment-2'], 'an expired authentic window must not poison later valid findings');
    await objectStorageUpload({ key: objectKey, body: Buffer.from('drift'), contentType: 'video/mp4' });
    assert.equal(await read(), null);
    assert.equal(await production(), null);
    assert.equal(await resumedWindow(), null);
    await assert.rejects(load(), /product_footage_shot_review_required/);
    await objectStorageUpload({ key: objectKey, body: bytes, contentType: 'video/mp4' });
    assert.ok(await read());
    const revocation: FootageRevocation = { kind: 'product-footage-revocation.v1', keyId: approval.keyId,
      issuerId: approval.issuerId, tenantId, productId, materialId: material.id, approvalId: baseApprovalId,
      revokedAt: '2026-10-18T01:45:00.000Z', reason: 'withdrawn' };
    await recordProductFootageRevocation({ store, signed: signed(revocation, keys.privateKey), authorities, now });
    assert.equal(await read(), null);
    assert.equal(await production(), null);
    assert.equal(await resumedWindow(), null);
    await assert.rejects(load(), /product_footage_shot_review_required/);
  } finally {
    if (previous.driver === undefined) delete process.env.OBJECT_STORAGE_DRIVER; else process.env.OBJECT_STORAGE_DRIVER = previous.driver;
    if (previous.root === undefined) delete process.env.LOCAL_OBJECT_STORAGE_ROOT; else process.env.LOCAL_OBJECT_STORAGE_ROOT = previous.root;
    if (previous.rightsKeys === undefined) delete process.env.PRODUCT_FOOTAGE_REVIEW_AUTHORITIES_JSON;
    else process.env.PRODUCT_FOOTAGE_REVIEW_AUTHORITIES_JSON = previous.rightsKeys;
    if (previous.visualKeys === undefined) delete process.env.PRODUCT_FOOTAGE_VISUAL_AUTHORITIES_JSON;
    else process.env.PRODUCT_FOOTAGE_VISUAL_AUTHORITIES_JSON = previous.visualKeys;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
