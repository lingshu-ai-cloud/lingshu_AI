import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSceneVisualContract } from '../../shared/sceneVisualContract.js';
import { buildLocalMaterialSegmentProfile } from '../../shared/contracts/localMaterialSegmentProfile.js';
import { createSocialAssetSupplyPlan } from '../../shared/socialContentAssetSupply.js';
import { materialRoutingRequests } from './socialContentMaterialRoutingRequests.js';
import { parseCreateSocialTask } from './socialContentValidation.js';
import type { BenchmarkMaterialType } from '../../shared/benchmarkAnalysis.js';

const plain = normalizeSceneVisualContract({ subjects: ['product'],
  interaction: { kind: 'product_only_display', description: '桌面展示' }, action: { path: '静止' }, productPolicy: 'open' });
function candidate(type: Exclude<BenchmarkMaterialType, 'unknown'>, assetId = 'owned') {
  const assessment = buildLocalMaterialSegmentProfile({ tenantId: 'tenant', sourceTenantId: 'tenant',
    assetId, segmentId: 'segment', sourceRevision: 'revision', origin: 'my_materials', mediaType: 'video',
    synthetic: false, productId: null, productRef: 'different-SKU',
    startSeconds: 0, endSeconds: 8, materialType: type, materialRoles: type === 'factory' ? ['factory'] : ['product'],
    visualContract: plain, rightsEvidenceRefs: ['rights'], commercialUseApproved: true,
    commercialUseApprovalEvidenceRefs: ['rights'], derivativeUseAllowed: true, modelInputAllowed: false,
    confidence: .95, needsReview: false, cleanEntry: true, cleanExit: true });
  return { assetId, sourceRef: assetId, segmentId: 'segment', sourceRevision: 'revision', origin: 'my_materials',
    mediaType: 'video', productRef: 'different-SKU', materialRoles: ['product'], visualContract: plain,
    timeRange: { startSeconds: 0, endSeconds: 8 }, matchScore: 1, segmentProfile: assessment.profile } as Parameters<typeof materialRoutingRequests>[0]['candidates'][number];
}
function route(type: BenchmarkMaterialType, candidates = [candidate(type === 'unknown' ? 'general' : type)]) {
  return materialRoutingRequests({ policyVersion: 'type-aware.v3', tenantId: 'tenant', productRef: 'task-SKU', candidates,
    shots: [{ shotId: 'slot', materialType: type, function: 'hook', plannedDurationSeconds: 2,
      requestedDescription: '人物必须涂抹旋转摇晃，近景构图', visualContract: plain }] });
}
const plan = (shots: ReturnType<typeof route>, presenterAssetIds: string[] = []) => createSocialAssetSupplyPlan({
  creationMode: 'viral_replication', productionApproach: 'ai_enhanced', materialRoutingPolicyVersion: 'type-aware.v3',
  inventory: { customerVideoIds: ['owned'], presenterAssetIds }, shots });

test('v3 keeps benchmark tags and admits topic footage despite different SKU/actions/people/composition', () => {
  for (const type of ['factory', 'product', 'consumer_demo', 'general'] as const) {
    const requests = route(type);
    assert.equal(requests[0]!.materialType, type);
    assert.deepEqual(requests[0]!.localVideoMatch?.sourceRefs, ['owned']);
    assert.deepEqual(requests[0]!.selectedMaterialSegment && [requests[0]!.selectedMaterialSegment.startSeconds, requests[0]!.selectedMaterialSegment.endSeconds], [0, 2]);
    const selected = plan(requests).shots[0]!;
    assert.equal(selected.sourceStrategy, 'customer_real_asset');
    assert.equal(selected.feasibility, 'full_fidelity');
    assert.equal(selected.materialRouting?.pendingReason, undefined);
    assert.equal(selected.productSceneReplication, undefined);
  }
});

test('v3 missing themes wait for supply and never borrow a different theme', () => {
  const selected = plan(route('factory', [candidate('product')])).shots[0]!;
  assert.equal(selected.materialRouting?.pendingReason, 'awaiting_theme_material');
  assert.equal(selected.feasibility, 'goal_degraded');
  assert.deepEqual(selected.sourceRefs, []);
});

test('v3 never guesses a missing benchmark label from visual descriptions or a stale shot label', () => {
  const reference = {shotId: 'ref', materialType: 'unknown', visualDescription: '工厂生产线正在运转',
    tags: {subjects: [], sceneTypes: [], subjectRelations: []}} as any;
  const requests = materialRoutingRequests({policyVersion: 'type-aware.v3', tenantId: 'tenant', productRef: null,
    candidates: [candidate('factory')], referenceShots: [reference], shots: [{shotId: 'slot', referenceShotId: 'ref',
      function: 'value', materialType: 'factory', requestedDescription: '工厂生产线'}]});
  assert.equal(requests[0]!.materialType, 'unknown');
  assert.equal(requests[0]!.localVideoMatch, undefined);
  const supply = createSocialAssetSupplyPlan({creationMode: 'viral_replication', productionApproach: 'ai_enhanced',
    materialRoutingPolicyVersion: 'type-aware.v3', inventory: {customerVideoIds: ['owned']}, shots: requests,
    referenceShots: [reference]});
  assert.equal(supply.shots[0]!.materialRouting?.pendingReason, 'material_label_unresolved');
  assert.equal(supply.shots[0]!.sourceRefs.length, 0);
});

test('v3 presenter prefers registered assets and otherwise produces a genuine waiting-for-shoot plan', () => {
  for (const ids of [[], ['presenter']] as string[][]) {
    const selected = plan(route('talking_head'), ids).shots[0]!;
    assert.equal(selected.sourceStrategy, 'authorized_digital_presenter');
    assert.equal(selected.customerShootRequired, !ids.length);
    assert.equal(selected.materialRouting?.pendingReason, ids.length ? undefined : 'awaiting_shoot');
    assert.deepEqual(selected.digitalHumanPlan?.presenterAssetIds, ids);
  }
});

test('v3 preserves slots and prefers distinct windows while allowing trusted same-segment reuse', () => {
  const shots = materialRoutingRequests({ policyVersion: 'type-aware.v3', tenantId: 'tenant', productRef: null,
    candidates: [candidate('product')], shots: [0, 1, 2].map(index => ({ shotId: `s${index}`,
      function: 'value', materialType: 'product', plannedDurationSeconds: 3 })) });
  assert.deepEqual(shots.map(shot => shot.shotId), ['s0', 's1', 's2']);
  assert.deepEqual(shots.slice(0, 2).map(shot => shot.selectedMaterialSegment?.startSeconds), [0, 3]);
  assert.deepEqual(shots[2]!.selectedMaterialSegment && [shots[2]!.selectedMaterialSegment.startSeconds, shots[2]!.selectedMaterialSegment.endSeconds], [0, 3]);
  assert.deepEqual(shots[2]!.localVideoMatch?.sourceRefs, ['owned']);
  const tooLong = materialRoutingRequests({ policyVersion: 'type-aware.v3', tenantId: 'tenant', productRef: null,
    candidates: [candidate('product')], shots: [{ shotId: 'long', function: 'value', materialType: 'product', plannedDurationSeconds: 9 }] });
  assert.equal(tooLong[0]!.localVideoMatch, undefined, 'reuse cannot manufacture a nine-second window from eight seconds');
});

test('v3 never treats a wrong tenant or missing source rights as a theme match', () => {
  const wrongTenant = candidate('product');
  wrongTenant.segmentProfile = { ...wrongTenant.segmentProfile!, tenantId: 'other' };
  assert.equal(route('product', [wrongTenant])[0]!.localVideoMatch, undefined);
});

test('new entry persists v3 and cannot silently replace its automatic allowance with an arbitrary grant', () => {
  const brief = parseCreateSocialTask({ title: '主题素材', objective: '按参考槽位制作', perItemBudgetCny: 600 });
  assert.equal(brief.materialRoutingPolicyVersion, 'type-aware.v3');
  assert.equal(brief.perItemBudgetCny, 15);
});
