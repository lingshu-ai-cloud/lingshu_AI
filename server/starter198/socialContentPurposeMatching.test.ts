import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSceneVisualContract } from '../../shared/sceneVisualContract.js';
import { enterpriseScenePurpose } from '../../shared/socialMaterialScenePurpose.js';
import { createSocialAssetSupplyPlan, classifySocialAssetSupplyMaterialType } from '../../shared/socialContentAssetSupply.js';
import { buildLocalMaterialSegmentProfile, inferLocalMaterialSegmentType } from '../../shared/contracts/localMaterialSegmentProfile.js';
import { materialRoutingRequests } from './socialContentMaterialRoutingRequests.js';
import { capabilityCandidates } from './socialContentAgentWorkflowPlanning.js';
import { assetSupplyPlanWithExecutionSelections, bindCanonicalTypeAwareRouting } from './socialContentExecutionPlan.js';
import type { SocialWorkflowMaterialClipCandidate } from './socialContentMaterialCandidateSupport.js';

const factory = normalizeSceneVisualContract({ subjects: ['person', 'factory', 'product'],
  interaction: { kind: 'person_factory_interaction', description: '工人操作灌装设备' },
  environment: { kind: 'factory', description: '企业生产车间' }, action: { path: '灌装液体到瓶内' } });
const factoryRoles = ['factory', 'product', 'person_usage', 'environment'] as const;
function candidate(id: string, visual = factory, materialRoles: string[] = [...factoryRoles], range = { startSeconds: 0, endSeconds: 4 }): SocialWorkflowMaterialClipCandidate {
  const built = buildLocalMaterialSegmentProfile({ tenantId: 'tenant', sourceTenantId: 'tenant', origin: 'my_materials',
    assetId: id, segmentId: `${id}-segment`, sourceRevision: 'revision', currentSourceRevision: 'revision',
    mediaType: 'video', synthetic: false, ...range, materialType: inferLocalMaterialSegmentType({ visualContract: visual, materialRoles: materialRoles as never[] }),
    materialRoles: materialRoles as never[], productId: null, productRef: null, visualContract: visual,
    rightsEvidenceRefs: ['rights://owner/asset'], commercialUseApproved: true, derivativeUseAllowed: true,
    modelInputAllowed: false, confidence: .95, needsReview: false, cleanEntry: true, cleanExit: true });
  return { assetId: id, sourceRef: id, segmentId: `${id}-segment`, sourceRevision: 'revision', label: id, mediaType: 'video',
    origin: 'my_materials', timeRange: range, materialRoles, visualContract: visual, productId: null, productRef: null,
    segmentProfile: built.profile, segmentProfileRejectionReasons: built.rejectionReasons, matchScore: 900,
    matchedVoiceoverCueIds: [], previewUrl: null, enterpriseCommon: true, productPolicy: 'open',
    segmentCandidateId: `${id}-candidate` } as SocialWorkflowMaterialClipCandidate;
}
const shot = (id: string, duration = 1) => ({ shotId: id, function: 'proof' as const,
  requestedDescription: '机器灌装液体到瓶内', visualContract: factory, plannedDurationSeconds: duration });
const route = (shots: Parameters<typeof materialRoutingRequests>[0]['shots'], candidates = [candidate('factory')]) =>
  materialRoutingRequests({ policyVersion: 'type-aware.v2', tenantId: 'tenant', shots, candidates, productRef: 'SKU' });

test('real factory operations tolerate worker/machine framing and mixed annotation roles, but never substitute another process', () => {
  assert.ok(route([shot('one')])[0]!.localVideoMatch);
  const packing = normalizeSceneVisualContract({ ...factory, interaction: { kind: 'person_factory_interaction', description: '工人装箱' }, action: { path: '工人将成品装箱' } });
  assert.equal(route([shot('one')], [candidate('packing', packing)])[0]!.localVideoMatch, undefined);
  assert.equal(route([shot('one')], [candidate('presenter', factory, ['factory', 'presenter'])])[0]!.localVideoMatch, undefined);
});

test('one observed clip supplies distinct non-overlapping windows until its actual duration is exhausted', () => {
  const requests = route([shot('a', 1.5), shot('b', 1.5), shot('c', 1), shot('d', .5)]);
  assert.deepEqual(requests.slice(0,3).map(item => [item.selectedMaterialSegment?.startSeconds, item.selectedMaterialSegment?.endSeconds]), [[0,1.5],[1.5,3],[3,4]]);
  assert.equal(requests[3]?.localVideoMatch, undefined);
});

test('overlapping analysis segments of the same file cannot reuse already allocated pixels', () => {
  const first = candidate('same', factory, [...factoryRoles], { startSeconds: 0, endSeconds: 2 });
  const second = { ...candidate('same', factory, [...factoryRoles], { startSeconds: 0, endSeconds: 4 }), segmentId: 'other' };
  second.segmentProfile = { ...second.segmentProfile!, segmentId: 'other' };
  const requests = route([shot('a', 1.5), shot('b', 1.5)], [first, second]);
  assert.deepEqual(requests.map(item => [item.selectedMaterialSegment?.startSeconds, item.selectedMaterialSegment?.endSeconds]), [[0,1.5],[1.5,3]]);
});

test('enterprise context and ordinary product use do not demand a task SKU without explicit reference binding', () => {
  const meeting = normalizeSceneVisualContract({ subjects: ['person', 'environment'],
    interaction: { kind: 'other', description: '一群人围坐进行商务洽谈' }, action: { path: '围坐品茶进行商务洽谈' }, environment: { kind: 'office' } });
  assert.equal(enterpriseScenePurpose(meeting), 'meeting');
  const request = { shotId: 'meeting', function: 'value' as const, requestedDescription: '一群人围坐进行商务洽谈', visualContract: meeting, plannedDurationSeconds: 1 };
  assert.equal(route([request], [candidate('meeting', meeting, ['environment', 'person_usage'])])[0]!.materialType, 'general');
  assert.ok(route([request], [candidate('meeting', meeting, ['environment', 'person_usage'])])[0]!.localVideoMatch);
  const use = normalizeSceneVisualContract({ subjects: ['person','product'], interaction: { kind: 'apply_product_to_face', description: '顾客试用涂抹上脸' }, productUsage: { kind: 'apply_to_face' } });
  assert.equal(enterpriseScenePurpose(use, '顾客在门店选购并涂抹上脸'), null);
  assert.equal(classifySocialAssetSupplyMaterialType({ ...request, visualContract: use, requestedDescription: '顾客涂抹上脸' }), 'consumer_demo');
  assert.ok(route([{ ...request, visualContract: use, requestedDescription: '顾客涂抹上脸' }], [candidate('usage', use, ['person_usage','product'])])[0]!.localVideoMatch, 'ordinary product use follows the open SKU policy while retaining action matching');
});

test('graphic contact cards reuse the existing local graphics adapter while product/result scenes do not become cards', () => {
  const description = '黑色背景，圆形头像与 CONTACT ME 图标';
  const card = { shotId: 'card', function: 'call_to_action' as const, requestedDescription: description,
    visualContract: normalizeSceneVisualContract({ subjects: ['environment'], interaction: { kind: 'other', description } }) };
  const plan = createSocialAssetSupplyPlan({ creationMode:'viral_replication', productionApproach:'ai_enhanced', materialRoutingPolicyVersion:'type-aware.v2', shots:[card] });
  assert.equal(plan.shots[0]?.sourceStrategy, 'motion_graphics');
  assert.equal(plan.shots[0]?.materialRouting?.policy, 'local_only');
  assert.deepEqual(plan.shots[0]?.sourceRefs, []);
  assert.equal(plan.shots[0]?.truthBoundary.syntheticVisualAllowed, true);
  assert.equal(bindCanonicalTypeAwareRouting(plan, plan).shots[0]?.sourceStrategy, 'motion_graphics');
  assert.equal(createSocialAssetSupplyPlan({ creationMode:'viral_replication', productionApproach:'ai_enhanced', materialRoutingPolicyVersion:'type-aware.v2',
    shots:[{...card,function:'value'}] }).shots[0]?.sourceStrategy,'motion_graphics','visible contact-card evidence survives a legacy narrative-role label');
  assert.notEqual(createSocialAssetSupplyPlan({ creationMode:'viral_replication', productionApproach:'ai_enhanced', materialRoutingPolicyVersion:'type-aware.v2', shots:[{ ...card,
    visualContract: normalizeSceneVisualContract({ subjects:['product'], interaction:{kind:'product_only_display'} }) }] }).shots[0]?.sourceStrategy, 'motion_graphics');
});

test('the allocated source window survives Director candidates and final execution selection; out-of-range windows fail before execution', () => {
  const asset = candidate('factory');
  const requests = route([shot('a',1), shot('b',1)], [asset]);
  const plan = createSocialAssetSupplyPlan({ creationMode:'material_processing', productionApproach:'ai_enhanced', materialRoutingPolicyVersion:'type-aware.v2',
    inventory:{factoryEvidenceAssetIds:['factory']},shots:requests });
  const supply = plan.shots[1]!;
  const context = { tenantId:'tenant', taskId:'task', taskVersion:'1', sceneId:'b', supply, materialCandidates:[asset],
    capabilityRuntime:[{strategy:'customer_real_asset' as const,adapterIds:['existing_customer_asset.v1'],environmentReady:true,reason:null}],
    scene:{sceneId:'b',purpose:'proof',duration:{startSeconds:1,endSeconds:2,targetSeconds:1},voiceoverLines:[],visualContract:factory} } as unknown as Parameters<typeof capabilityCandidates>[0];
  const candidates = capabilityCandidates(context);
  assert.equal(candidates.length,1);
  assert.deepEqual(candidates[0]?.timeRange,{startSeconds:1,endSeconds:2});
  const selected = assetSupplyPlanWithExecutionSelections(plan,{executionPlan:{scenes:[{sceneId:'b',candidates,
    recommendedCandidateIds:[candidates[0]!.candidateId],selectedSourceStrategy:'customer_real_asset',fallbackSourceStrategy:null}]}} as never);
  assert.equal(selected.shots[1]?.selectedMaterialSegment?.startSeconds,1);
  assert.equal(selected.shots[1]?.selectedMaterialSegment?.endSeconds,2);
  assert.throws(()=>capabilityCandidates({...context,supply:{...supply,selectedMaterialSegment:{...supply.selectedMaterialSegment!,endSeconds:5}}}),/material_execution_window_invalid/);
});
