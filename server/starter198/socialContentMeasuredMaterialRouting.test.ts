import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLocalMaterialSegmentProfile} from '../../shared/contracts/localMaterialSegmentProfile.js';
import {normalizeSceneVisualContract} from '../../shared/sceneVisualContract.js';
import {createSocialAssetSupplyPlan} from '../../shared/socialContentAssetSupply.js';
import {themeMaterialRoutingRequests} from './socialContentThemeMaterialRouting.js';
import {reconcileMeasuredMaterialRouting} from './socialContentMeasuredMaterialRouting.js';
import {routeSceneReworkMaterials} from './socialContentSceneReworkMaterialRouting.js';
import type {SocialWorkflowMaterialClipCandidate} from './socialContentRecords.js';
import type {MeasuredSceneTime} from './socialContentMeasuredSceneTimeline.js';

function candidate(assetId = 'local', seconds = 8, materialType: 'product' | 'factory' = 'product'): SocialWorkflowMaterialClipCandidate {
  const visualContract = normalizeSceneVisualContract({subjects: ['product'],
    interaction: {kind: 'product_only_display', description: '桌面'}, productPolicy: 'open'});
  const {profile} = buildLocalMaterialSegmentProfile({tenantId: 'tenant', sourceTenantId: 'tenant', assetId,
    segmentId: 'segment', sourceRevision: 'rev', origin: 'my_materials', mediaType: 'video', synthetic: false,
    productId: null, productRef: 'other-SKU', startSeconds: 0, endSeconds: seconds, materialType,
    materialRoles: [materialType], visualContract, rightsEvidenceRefs: ['rights'], commercialUseApproved: true,
    commercialUseApprovalEvidenceRefs: ['rights'], derivativeUseAllowed: true, modelInputAllowed: false,
    confidence: .95, needsReview: false, cleanEntry: true, cleanExit: true});
  return {assetId, sourceRef: assetId, segmentId: 'segment', sourceRevision: 'rev', origin: 'my_materials',
    mediaType: 'video', productRef: 'other-SKU', materialRoles: [materialType], visualContract,
    timeRange: {startSeconds: 0, endSeconds: seconds}, matchScore: 1, segmentProfile: profile} as SocialWorkflowMaterialClipCandidate;
}
function plan(candidates = [candidate()], types: Array<'product' | 'talking_head' | 'factory'> = ['product']) {
  return createSocialAssetSupplyPlan({creationMode: 'viral_replication', productionApproach: 'ai_enhanced',
    materialRoutingPolicyVersion: 'type-aware.v3', inventory: {customerVideoIds: candidates.map(row => row.assetId)},
    shots: themeMaterialRoutingRequests({tenantId: 'tenant', candidates, productRef: 'task-SKU',
      shots: types.map((materialType, index) => ({shotId: `s${index}`, function: 'value', materialType, plannedDurationSeconds: 2}))})});
}
function timeline(seconds: number[]): MeasuredSceneTime[] {
  let start = 0;
  return seconds.map((duration, index) => { const end = start + duration;
    const row: MeasuredSceneTime = {shotId: `s${index}`, start, end, timingSource: 'measured_boundary', anchorStart: start, anchorEnd: end};
    start = end; return row; });
}
test('selected rework rematches a new same-theme source at the measured duration and keeps other slots', () => {
  const original = plan([candidate('old'), candidate('other')], ['product','product']);
  const saved = structuredClone(original);
  const result = routeSceneReworkMaterials({tenantId:'tenant', plan:original, timeline:timeline([4,2]),
    candidates:[candidate('old'), candidate('other'), candidate('factory',8,'factory')], affectedSceneIds:['s0']});
  assert.deepEqual(original,saved);
  assert.equal(result.plan.shots[0]!.selectedMaterialSegment!.sourceRef,'other');
  assert.equal(result.plan.shots[0]!.selectedMaterialSegment!.endSeconds,4);
  assert.deepEqual(result.plan.shots[1],saved.shots[1]);
  assert.deepEqual(result.pending,[]);
  const pending=routeSceneReworkMaterials({tenantId:'tenant',plan:original,timeline:timeline([4,2]),
    candidates:[candidate('old'),candidate('factory',8,'factory')],affectedSceneIds:['s0']});
  assert.deepEqual(pending.pending,['s0']);
});
test('measured material keeps current start and legally trims or extends inside analyzed window', () => {
  for (const [duration, kind] of [[1, 'trimmed'], [2, 'retained'], [5, 'extended']] as const) {
    const original = plan();
    original.shots[0]!.selectedMaterialSegment = {...original.shots[0]!.selectedMaterialSegment!, startSeconds: 2, endSeconds: 4};
    const before = structuredClone(original);
    const result = reconcileMeasuredMaterialRouting({tenantId: 'tenant', plan: original, timeline: timeline([duration]), candidates: [candidate()]});
    assert.deepEqual(original, before, 'no mutation of frozen input');
    assert.equal(result.changes[0]!.kind, kind);
    assert.deepEqual(result.pending, []);
    assert.equal(result.plan.shots[0]!.selectedMaterialSegment!.startSeconds, 2);
    assert.equal(result.plan.shots[0]!.selectedMaterialSegment!.endSeconds, 2 + duration);
  }
});
test('insufficient remaining current window rematches a complete same-theme window', () => {
  const original = plan();
  original.shots[0]!.selectedMaterialSegment = {...original.shots[0]!.selectedMaterialSegment!, startSeconds: 6, endSeconds: 8};
  const result = reconcileMeasuredMaterialRouting({tenantId: 'tenant', plan: original, timeline: timeline([5]), candidates: [candidate()]});
  assert.equal(result.changes[0]!.kind, 'rematched');
  assert.equal(result.plan.shots[0]!.selectedMaterialSegment!.startSeconds, 0);
  assert.equal(result.plan.shots[0]!.selectedMaterialSegment!.endSeconds, 5);
});
test('longer actual slot switches to another same-theme source without SKU/action requirements', () => {
  const result = reconcileMeasuredMaterialRouting({tenantId: 'tenant', plan: plan([candidate('short', 2)]),
    timeline: timeline([6]), candidates: [candidate('short', 2), candidate('long', 7), candidate('factory', 10, 'factory')]});
  assert.deepEqual(result.plan.shots[0]!.sourceRefs, ['long']);
  assert.equal(result.changes[0]!.kind, 'rematched');
});
test('a user-selected replacement is mandatory for its original slot and cannot silently fall back', () => {
  const original = plan([candidate('old', 2)]);
  const common = {tenantId: 'tenant', plan: original, timeline: timeline([4]), requiredMaterials: {s0: 'selected'}};
  const selected = reconcileMeasuredMaterialRouting({...common, candidates: [candidate('old', 8), candidate('selected', 6)]});
  assert.deepEqual(selected.plan.shots[0]!.sourceRefs, ['selected']);
  const absent = reconcileMeasuredMaterialRouting({...common, candidates: [candidate('old', 8)]});
  assert.equal(absent.pending[0]?.shotId, 's0');
  assert.deepEqual(absent.plan.shots[0]!.sourceRefs, []);
  const short = reconcileMeasuredMaterialRouting({...common, candidates: [candidate('old', 8), candidate('selected', 2)]});
  assert.equal(short.pending[0]?.shotId, 's0');
});
test('missing theme becomes per-slot pending, clears stale match, keeps other and talking slots', () => {
  const original = plan([candidate()], ['product', 'talking_head', 'factory']);
  const result = reconcileMeasuredMaterialRouting({tenantId: 'tenant', plan: original,
    timeline: timeline([3, 2, 3]), candidates: [candidate()]});
  assert.deepEqual(result.plan.shots.map(shot => shot.shotId), ['s0', 's1', 's2']);
  assert.deepEqual(result.plan.shots[1], original.shots[1]);
  assert.deepEqual(result.plan.shots[0]!.sourceRefs, ['local']);
  assert.deepEqual(result.pending.map(row => [row.shotId, row.theme, row.requiredSeconds, row.pendingReason]),
    [['s2', 'factory', 3, 'awaiting_theme_material']]);
  assert.deepEqual(result.plan.shots[2]!.sourceRefs, []);
  assert.equal(result.plan.shots[2]!.selectedMaterialSegment, null);
  assert.equal(result.plan.shots[2]!.materialRouting!.localMatch.state, 'missing');
  assert.equal(result.pending[0]!.rejections[0]!.reasons.includes('material_type_mismatch'), true);
});
test('current source is revalidated against current tenant, revision and permission evidence', () => {
  for (const invalid of ['tenant', 'revision', 'rights'] as const) {
    const current = candidate();
    if (invalid === 'tenant') current.segmentProfile = {...current.segmentProfile!, tenantId: 'other'};
    if (invalid === 'revision') current.sourceRevision = 'new-revision';
    if (invalid === 'rights') current.segmentProfile = {...current.segmentProfile!, rejectionReasons: ['rights_evidence_missing']};
    const result = reconcileMeasuredMaterialRouting({tenantId: 'tenant', plan: plan(), timeline: timeline([3]), candidates: [current]});
    assert.equal(result.pending.length, 1);
    assert.equal(result.plan.shots[0]!.materialRouting!.localMatch.evidenceRef, null);
  }
});
test('same trusted source may cover multiple slots; historical frozen policies remain unchanged', () => {
  const original = plan([candidate('local', 4)], ['product', 'product']);
  const result = reconcileMeasuredMaterialRouting({tenantId: 'tenant', plan: original, timeline: timeline([4, 4]), candidates: [candidate('local', 4)]});
  assert.equal(result.pending.length, 0);
  assert.deepEqual(result.plan.shots.map(shot => shot.selectedMaterialSegment!.endSeconds), [4, 4]);
  original.materialRoutingPolicyVersion = 'type-aware.v2';
  assert.deepEqual(reconcileMeasuredMaterialRouting({tenantId: 'tenant', plan: original, timeline: [], candidates: []}).plan, original);
});
test('rejects missing, reordered, duplicate, invalid or discontinuous measured slots', () => {
  const original = plan([candidate()], ['product', 'product']);
  const cases = [[], timeline([2, 2]).reverse(), [{...timeline([2, 2])[0]!, shotId: 's1'}, timeline([2, 2])[1]!],
    [timeline([2, 2])[0]!, {...timeline([2, 2])[1]!, start: 3}],
    [timeline([2, 2])[0]!, {...timeline([2, 2])[1]!, end: NaN}]];
  for (const rows of cases) assert.throws(() => reconcileMeasuredMaterialRouting({tenantId: 'tenant', plan: original,
    timeline: rows, candidates: [candidate()]}), /measured_material_timeline_changed/);
});
