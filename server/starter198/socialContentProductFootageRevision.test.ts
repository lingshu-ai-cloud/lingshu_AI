import assert from 'node:assert/strict';
import test from 'node:test';
import type { SocialAssetSupplyPlan } from '../../shared/contracts/socialContentWorkflow.js';
import { socialAssetSupplyPlanIdentityHash } from './socialAssetSupplyPlanIdentity.js';
import { createVerifiedProductFootageRevision, readVerifiedProductFootageRevision } from './socialContentProductFootageRevision.js';
import { socialRequestHash } from './socialContentValidation.js';

const evidence = { contentSha256: 'a'.repeat(64), productId: 'product', sceneFunction: 'demonstration',
  approvalId: 'b'.repeat(15), visualFindingId: 'c'.repeat(15) };
const plan = { planVersion: '7', shots: [{ shotId: 'S01', sourceRefs: ['footage'],
  materialRouting: { materialType: 'product', policy: 'local_only', localMatch: {
    state: 'matched', sourceRefs: ['footage'], productRef: 'product', evidenceRef: 'match',
  } }, selectedMaterialSegment: { sourceRef: 'footage', segmentId: 'window', startSeconds: 1, endSeconds: 3 },
  productionInstruction: 'unchanged', narrationOwnerShotId: 'S01',
}, { shotId: 'S02', sourceRefs: ['other'], productionInstruction: 'keep' }] } as unknown as SocialAssetSupplyPlan;

function fixture() {
  let reads = 0;
  const input = { store: {} as any, readMaterials: async () => ({ status: 'ready' as const, items: [] }),
    tenantId: 'tenant', taskId: 'task', sourceRunId: 'old-run', sourceTaskVersion: '7',
    budgetLedgerRef: 'original-10-cny-ledger', productId: 'product', sourcePlan: structuredClone(plan),
    shotId: 'S01', evidence: structuredClone(evidence),
    readCurrentPlan: async () => structuredClone(plan),
    readBudgetLedgerRef: async () => 'original-10-cny-ledger',
    readReviewedSegment: async (request: any) => { reads++;
      return { material: { id: request.materialId, productId: request.productId,
        contentSha256: request.expectedContentSha256 }, segmentId: request.segmentId,
      startSeconds: request.startSeconds, endSeconds: request.endSeconds }; },
  };
  return { input, readCount: () => reads };
}

test('exact same-SKU window creates only a non-executable new plan, preserving other shots and source plan', async () => {
  const f = fixture();
  const result = await createVerifiedProductFootageRevision(f.input);
  assert.equal(f.readCount(), 2);
  assert.equal(result.authorizesQueue, false);
  assert.equal(result.authorizesProvider, false);
  assert.equal(result.authorizesProduction, false);
  assert.equal(result.revision.sourceRunId, 'old-run');
  assert.equal(result.revision.budgetLedgerRef, 'original-10-cny-ledger');
  assert.equal(result.revision.sourcePlanHash, socialAssetSupplyPlanIdentityHash(plan));
  assert.equal(result.revision.revisedPlanHash, socialAssetSupplyPlanIdentityHash(result.plan));
  const { recordHash, ...body } = result.revision;
  assert.equal(recordHash, socialRequestHash(body));
  assert.deepEqual(result.plan.shots[1], plan.shots[1]);
  assert.deepEqual(result.plan.shots[0]?.selectedMaterialSegment?.footageEvidence, evidence);
  assert.equal(plan.shots[0]?.selectedMaterialSegment?.footageEvidence, undefined);
  assert.equal(result.plan.shots[0]?.productionInstruction, plan.shots[0]?.productionInstruction);
});

test('changed plan, budget, wrong SKU and already-reviewed source fail before any material approval read', async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.input.readCurrentPlan = async () => ({ ...plan, planVersion: '8' }); },
    (f: ReturnType<typeof fixture>) => { f.input.readBudgetLedgerRef = async () => 'another-ledger'; },
    (f: ReturnType<typeof fixture>) => { f.input.evidence.productId = 'other'; },
    (f: ReturnType<typeof fixture>) => { f.input.sourcePlan.shots[0]!.selectedMaterialSegment!.footageEvidence = evidence; },
    (f: ReturnType<typeof fixture>) => { f.input.sourcePlan.shots[0]!.materialRouting!.localMatch.productRef = 'other'; },
  ]) {
    const f = fixture(); change(f);
    await assert.rejects(createVerifiedProductFootageRevision(f.input), /product_footage_revision_/);
    assert.equal(f.readCount(), 0);
  }
});

test('revoked finding or changed bytes on second read cannot become a revision candidate', async () => {
  const f = fixture();
  f.input.readReviewedSegment = async () => null as any;
  await assert.rejects(createVerifiedProductFootageRevision(f.input), /review_not_current/);
  const g = fixture();
  let count = 0;
  g.input.readReviewedSegment = async (request: any) => {
    count++;
    return { material: { id: request.materialId, productId: request.productId,
      contentSha256: count === 2 ? 'd'.repeat(64) : request.expectedContentSha256 },
      segmentId: request.segmentId, startSeconds: request.startSeconds, endSeconds: request.endSeconds } as any;
  };
  await assert.rejects(createVerifiedProductFootageRevision(g.input), /review_changed/);
});

test('stored candidate is rebuilt from signed current authority and rejects tampering or later revocation', async () => {
  const f = fixture();
  const prepared = await createVerifiedProductFootageRevision(f.input);
  const base = { ...f.input, storedPlan: prepared.plan, storedRevision: prepared.revision };
  assert.deepEqual((await readVerifiedProductFootageRevision(base)).revision, prepared.revision);
  await assert.rejects(readVerifiedProductFootageRevision({ ...base,
    storedPlan: { ...prepared.plan, shots: prepared.plan.shots.map(shot => ({ ...shot,
      productionInstruction: 'changed after freeze' })) },
  }), /stored_candidate_changed/);
  f.input.readReviewedSegment = async () => null as any;
  await assert.rejects(readVerifiedProductFootageRevision({ ...base,
    readReviewedSegment: f.input.readReviewedSegment }), /review_not_current/);
});
