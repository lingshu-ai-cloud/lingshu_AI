import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { LangGraphTestStore } from '../../scripts/langgraphTestStore.js';
import { createStarter198Repository, STARTER_COLLECTIONS } from './repository.js';
import { prepareSocialProductAssetFallback, readPreparedSocialProductAssetFallback } from './socialContentProductAssetRevisionPrepare.js';
import { socialObject, socialJson, socialRequestHash } from './socialContentValidation.js';
import { createPresenterFirstFrameAssetProvenance } from './socialContentPresenterFirstFrameAssetProvenance.js';
import { startSocialContentTask } from './socialContentTasks.js';

test('asset fallback prepare persists only a CAS intent; disk restart replays without changing voice or budget', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-fallback-cas-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'store.json');
  const first = new LangGraphTestStore(file);
  const repository = createStarter198Repository(first);
  await first.create(STARTER_COLLECTIONS.socialContentTasks, { id: 'task-row', tenant_id: 'tenant', task_id: 'task',
    version: '7', status: 'attention', run_id: 'run', last_operation_id: 'old',
    brief: { productId: 'product', voice: 'voice-original', perItemBudgetCny: 10 } });
  await first.create(STARTER_COLLECTIONS.runs, { id: 'run', tenant_id: 'tenant', status: 'failed',
    starter_context: { socialTaskId: 'task' } });
  const bytes = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#ddd' } }).png().toBuffer();
  const digest = createHash('sha256').update(bytes).digest('hex');
  const primary: any = { id: 'primary', tenantId: 'tenant', productId: 'product', type: 'image', scope: 'own',
    sourceType: 'enterprise_product_table', contentSha256: digest, rightsStatus: 'authorized', rightsEvidenceRef: 'rights:primary', commercialUseApproved: true };
  const backup: any = { ...primary, id: 'backup', rightsEvidenceRef: 'rights:backup' };
  const plan: any = { planVersion: '7', shots: [{ shotId: 'shot', sourceRefs: ['primary'],
    materialRouting: { generation: { productImageRefs: ['primary'] } } }] };
  const input = { repository, tenantId: 'tenant', userId: 'system:asset-recovery', taskId: 'task',
    expectedVersion: '7', sourceRunId: 'run', productId: 'product', failedAssetId: 'primary',
    sourcePlan: plan, materials: [primary, backup], budgetLedgerRef: 'ledger:original', idempotencyKey: 'asset-cas-1',
    readCurrentPlan: async () => structuredClone(plan),
    loadBytes: async (record: any) => { if (record.id === 'primary') throw Error('gone'); return bytes; } };
  const prepared = await prepareSocialProductAssetFallback(input);
  assert.equal(prepared.authorizesStart, false);
  const second = new LangGraphTestStore(file);
  const restarted = createStarter198Repository(second);
  const replay = await prepareSocialProductAssetFallback({ ...input, repository: restarted });
  assert.deepEqual(replay, prepared);
  const task = await restarted.get(STARTER_COLLECTIONS.socialContentTasks, 'tenant', 'task-row');
  const brief = socialObject(socialJson(task?.brief));
  const marker = socialObject(brief?._productAssetFallback);
  assert.equal(task?.version, '8');
  assert.equal(task?.run_id, 'run');
  assert.equal(brief?.voice, 'voice-original');
  assert.equal(brief?.perItemBudgetCny, 10);
  assert.equal(marker?.budgetLedgerRef, 'ledger:original');
  assert.equal(marker?.state, 'prepared_not_admitted');
  assert.deepEqual((marker?.revisedPlan as any).shots[0].sourceRefs, ['backup']);
  const oldProvenance = createPresenterFirstFrameAssetProvenance({
    presenter: { assetId: 'person', assetVersion: 1, referenceAssetIds: ['face'], referenceSha256s: ['a'.repeat(64)] },
    products: [{ productId: 'product', enterpriseFactRef: 'fact', enterpriseFactVersion: 'v1',
      referenceImageIds: ['primary'], referenceImageSha256s: [digest] }],
    background: { referenceSourceId: 'video', referenceShotId: 'shot', startSeconds: 0, endSeconds: 3,
      referenceFirstFrameRef: 'frame', referenceFirstFrameSha256: 'b'.repeat(64) },
  });
  const readInput = { repository: restarted, tenantId: 'tenant', taskId: 'task', expectedPreparedVersion: '8',
    sourceRunId: 'run', budgetLedgerRef: 'ledger:original', readBudgetLedgerRef: async () => 'ledger:original',
    readReplacementMaterial: async () => backup,
    readReplacementBytes: async () => bytes,
    oldFirstFrameProvenance: oldProvenance };
  const admitted = await readPreparedSocialProductAssetFallback(readInput);
  assert.equal(admitted.authorizesStart, false);
  assert.notEqual(admitted.replacementProvenanceHash, oldProvenance.manifestHash);
  assert.deepEqual(admitted.plan.shots[0]!.sourceRefs, ['backup']);
  let enqueues = 0;
  await assert.rejects(startSocialContentTask({ repository: restarted, tenantId: 'tenant', userId: 'owner',
    taskId: 'task', expectedVersion: '8', idempotencyKey: 'ordinary-start-wrong',
    orchestratorQueue: { enqueue: async () => { enqueues++; return { queueItemId: 'queued', runId: 'new-run' }; } } }),
  /product_asset_fallback_start_adapter_required/);
  assert.equal(enqueues, 0);
  await assert.rejects(readPreparedSocialProductAssetFallback({ ...readInput,
    readBudgetLedgerRef: async () => 'new-ledger' }), /product_asset_fallback_budget_changed/);
  await assert.rejects(readPreparedSocialProductAssetFallback({ ...readInput,
    expectedPreparedVersion: '9' }), /product_asset_fallback_prepared_changed/);
  await assert.rejects(readPreparedSocialProductAssetFallback({ ...readInput,
    readReplacementBytes: async () => Buffer.from('changed') }), /product_asset_fallback_replacement_changed/);
  await assert.rejects(readPreparedSocialProductAssetFallback({ ...readInput,
    readReplacementMaterial: async () => ({ ...backup, commercialUseApproved: false }) }), /product_asset_fallback_replacement_changed/);
  await restarted.update(STARTER_COLLECTIONS.socialContentTasks, 'tenant', task!.id, {
    replication_script: { shots: [{ shotId: 'unexpected' }] },
  });
  await assert.rejects(readPreparedSocialProductAssetFallback(readInput), /product_asset_fallback_prepared_changed/,
    'a changed source script cannot inherit the old fallback plan');
  await restarted.update(STARTER_COLLECTIONS.socialContentTasks, 'tenant', task!.id, { replication_script: null });
  const changedBrief = structuredClone(brief!);
  (changedBrief._productAssetFallback as any).sourcePlan.shots[0].sourceRefs = ['other-product'];
  await restarted.update(STARTER_COLLECTIONS.socialContentTasks, 'tenant', task!.id, { brief: changedBrief });
  await assert.rejects(readPreparedSocialProductAssetFallback(readInput), /product_asset_fallback_prepared_changed/,
    'a changed frozen source plan cannot be mixed with the backup image');
  const mixedBrief = structuredClone(brief!);
  (mixedBrief._productAssetFallback as any).revisedPlan.shots[0].sourceRefs = ['other-product'];
  (mixedBrief._productAssetFallback as any).revisedPlanHash = socialRequestHash(
    (mixedBrief._productAssetFallback as any).revisedPlan);
  await restarted.update(STARTER_COLLECTIONS.socialContentTasks, 'tenant', task!.id, { brief: mixedBrief });
  await assert.rejects(readPreparedSocialProductAssetFallback(readInput), /product_asset_fallback_prepared_corrupt/,
    'a self-rehashed mixed-product plan must not inherit the backup image authority');
  await assert.rejects(prepareSocialProductAssetFallback({ ...input, repository: restarted, idempotencyKey: 'asset-cas-2' }),
    /product_asset_fallback_source_changed/);
});

test('source-plan drift and live run fail closed before any asset revision marker', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-fallback-fence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new LangGraphTestStore(path.join(root, 'store.json'));
  const repository = createStarter198Repository(store);
  await store.create(STARTER_COLLECTIONS.socialContentTasks, { id: 'row', tenant_id: 'tenant', task_id: 'task',
    version: '7', status: 'attention', run_id: 'run', last_operation_id: 'old', brief: { productId: 'product' } });
  await store.create(STARTER_COLLECTIONS.runs, { id: 'run', tenant_id: 'tenant', status: 'running',
    starter_context: { socialTaskId: 'task' } });
  const plan: any = { planVersion: '7', shots: [{ shotId: 'shot', sourceRefs: ['primary'] }] };
  const base = { repository, tenantId: 'tenant', userId: 'system:asset-recovery', taskId: 'task',
    expectedVersion: '7', sourceRunId: 'run', productId: 'product', failedAssetId: 'primary',
    sourcePlan: plan, materials: [] as any[], budgetLedgerRef: 'ledger:original',
    idempotencyKey: 'live', readCurrentPlan: async () => plan };
  await assert.rejects(prepareSocialProductAssetFallback(base), /product_asset_fallback_source_run_active/);
  const row = await repository.get(STARTER_COLLECTIONS.runs, 'tenant', 'run');
  await repository.update(STARTER_COLLECTIONS.runs, 'tenant', row!.id, { status: 'failed' });
  await assert.rejects(prepareSocialProductAssetFallback({ ...base, idempotencyKey: 'drift',
    readCurrentPlan: async () => ({ ...plan, planVersion: 'tampered' }) }), /product_asset_fallback_source_plan_changed/);
  const task = await repository.get(STARTER_COLLECTIONS.socialContentTasks, 'tenant', 'row');
  assert.equal(socialObject(socialJson(task?.brief))?._productAssetFallback, undefined);
  assert.equal(task?.version, '7');
});
