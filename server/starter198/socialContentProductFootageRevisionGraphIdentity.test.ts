import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LangGraphTestStore } from '../../scripts/langgraphTestStore.js';
import { createStarter198Repository, STARTER_COLLECTIONS } from './repository.js';
import { readHandoffProductFootageRevisionSupply } from './socialContentProductFootageRevisionProjection.js';
import { socialAssetSupplyPlanIdentityHash } from './socialAssetSupplyPlanIdentity.js';
import { createSocialProductionExecutorCheckpoint, socialProductionGraphInput } from './socialContentProductionGraph.js';

const supply = (sourceRef: string) => ({ planVersion: '7:footage-review:bound',
  shots: [{ shotId: 'S01', sourceRefs: [sourceRef], selectedMaterialSegment: {
    sourceRef, segmentId: 'exact-window', startSeconds: 1, endSeconds: 3,
    footageEvidence: { contentSha256: 'a'.repeat(64), productId: 'product',
      sceneFunction: 'demonstration', approvalId: 'approval', visualFindingId: 'finding' } } }] });
const workflow = { directorBrief: { scenes: [] }, executionPlan: { version: '1', scenes: [] },
  executionPlanReview: { approved: true }, productionResult: null, replicationEvaluation: null };
const detail = (sourceRef: string) => {
  const assetSupplyPlan = supply(sourceRef);
  return { version: '8', mode: 'weekly', brief: { productionApproach: 'ai_enhanced' },
    sources: [], agentWorkflow: structuredClone(workflow), assetSupplyPlan,
    footageRevisionPlanHash: socialAssetSupplyPlanIdentityHash(assetSupplyPlan as any) } as any;
};

test('same-task footage revision binds exact plan and evidence into graph identity without admitting worker', () => {
  const original = detail('same-sku-video');
  const frozen = createSocialProductionExecutorCheckpoint(original);
  assert.equal(frozen.payload.executor, 'langgraph');
  assert.equal((frozen.payload as any).approvedContext.footageRevisionPlanHash, original.footageRevisionPlanHash);
  const restored = structuredClone(JSON.parse(JSON.stringify(original)));
  assert.equal(socialProductionGraphInput(restored).inputHash, frozen.inputHash);
  const changed = detail('different-video');
  assert.notEqual(socialProductionGraphInput(changed).inputHash, frozen.inputHash);
  const evidenceChanged = detail('same-sku-video');
  evidenceChanged.assetSupplyPlan.shots[0].selectedMaterialSegment.footageEvidence.contentSha256 = 'c'.repeat(64);
  evidenceChanged.footageRevisionPlanHash = socialAssetSupplyPlanIdentityHash(evidenceChanged.assetSupplyPlan);
  assert.notEqual(socialProductionGraphInput(evidenceChanged).inputHash, frozen.inputHash);
  assert.throws(() => socialProductionGraphInput(original, {
    ...(frozen.payload as any).approvedContext, assetSupplyPlan: changed.assetSupplyPlan }),
  /graph_footage_revision_plan_changed/);
  assert.throws(() => socialProductionGraphInput(original, {
    ...(frozen.payload as any).approvedContext, footageRevisionPlanHash: 'b'.repeat(64) }),
  /graph_footage_revision_plan_changed/);
  const ordinary = { ...original, footageRevisionPlanHash: undefined };
  assert.equal(socialProductionGraphInput(ordinary).inputHash,
    socialProductionGraphInput({ ...ordinary, assetSupplyPlan: changed.assetSupplyPlan }).inputHash);
});

test('projection never promotes a prepared marker without durable run handoff after restart', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'footage-projection-blocked-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'store.json');
  const store = new LangGraphTestStore(file), repository = createStarter198Repository(store);
  const revisedPlan = supply('same-sku-video');
  const marker = { schemaVersion: 'social-product-footage-revision-prepare.v1',
    tenantId: 'tenant', taskId: 'task', sourceRunId: 'old-run', sourceTaskVersion: '7',
    sourcePlan: revisedPlan, revisedPlan, sourcePlanHash: socialAssetSupplyPlanIdentityHash(revisedPlan as any),
    budgetLedgerRef: 'ledger:original',
    revision: { productId: 'product', shotId: 'S01', revisedPlanHash:socialAssetSupplyPlanIdentityHash(revisedPlan as any),evidence: {
      contentSha256: 'a'.repeat(64), productId: 'product', sceneFunction: 'demonstration',
      approvalId: 'approval', visualFindingId: 'finding' } } };
  await store.create(STARTER_COLLECTIONS.socialContentTasks, { id: 'task-row', tenant_id: 'tenant',
    task_id: 'task', run_id: 'old-run', brief: { _productFootageRevision: marker } });
  const source = (await repository.get(STARTER_COLLECTIONS.socialContentTasks, 'tenant', 'task-row'))!;
  assert.equal(await readHandoffProductFootageRevisionSupply({ repository, tenantId: 'tenant',
    taskId: 'task', task: source }), null);
  await store.update(STARTER_COLLECTIONS.socialContentTasks, 'task-row', { run_id: 'new-run' });
  const restarted = createStarter198Repository(new LangGraphTestStore(file));
  const switched = (await restarted.get(STARTER_COLLECTIONS.socialContentTasks, 'tenant', 'task-row'))!;
  await assert.rejects(readHandoffProductFootageRevisionSupply({ repository: restarted,
    tenantId: 'tenant', taskId: 'task', task: switched }), /product_footage_revision_projection_handoff_missing/);
});
