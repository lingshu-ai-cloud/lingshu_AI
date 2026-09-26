import assert from 'node:assert/strict';
import {
  createSocialAssetSupplyPlan,
  inferSocialAssetAvailability,
} from './socialContentAssetSupply';

assert.equal(inferSocialAssetAvailability(), 'none');
assert.equal(inferSocialAssetAvailability({ productImageIds: ['product-1'] }), 'limited');
assert.equal(inferSocialAssetAvailability({ customerVideoIds: ['video-1'] }), 'ready');

const zeroAssetPlan = createSocialAssetSupplyPlan({
  creationMode: 'material_processing',
  confirmedFactRefs: ['fact-product-name', 'fact-value'],
});

assert.equal(zeroAssetPlan.assetAvailability, 'none');
assert.equal(zeroAssetPlan.productionRoute, 'zero_asset_generation');
assert.equal(zeroAssetPlan.managementMode, 'one_click_managed');
assert.equal(zeroAssetPlan.status, 'ready');
assert.equal(zeroAssetPlan.overallFeasibility, 'functional_equivalent');
assert.equal(zeroAssetPlan.canProduceWithoutCustomerShoot, true);
assert.ok(zeroAssetPlan.shots.length >= 4);
assert.ok(zeroAssetPlan.shots.every(shot => shot.customerShootRequired === false));
assert.equal(zeroAssetPlan.shots[0]?.sourceStrategy, 'authorized_digital_presenter');
assert.ok(zeroAssetPlan.shots.every(shot => shot.sourceStrategy !== 'customer_real_asset'));
assert.equal(zeroAssetPlan.shots[0]?.digitalHumanPlan?.executionState, 'needs_presenter');
assert.equal(zeroAssetPlan.shots[0]?.digitalHumanPlan?.accountPresenterLock, null);

const presenterLock = {
  socialAccountId: 'tiktok-account-1', presenterProfileId: 'profile-1', presenterProfileVersion: '3',
  presenterAssetId: 'presenter-enterprise-1', avatarId: 'avatar-1', voiceProfileId: 'voice-1',
  consentRef: 'consent-1', commercialRightsStatus: 'cleared' as const, status: 'published' as const,
  consistencyKey: 'tiktok-account-1:profile-1:3',
};

const presenterDrivenPlan = createSocialAssetSupplyPlan({
  creationMode: 'material_processing',
  confirmedFactRefs: ['fact-product-name'],
  inventory: { presenterAssetIds: ['presenter-enterprise-1'] },
  accountPresenterLock: presenterLock,
  shots: [{ shotId: 'presenter-value', function: 'value', requestedDescription: '企业人物介绍产品价值' }],
});
assert.equal(presenterDrivenPlan.shots[0]?.sourceStrategy, 'authorized_digital_presenter');
assert.deepEqual(presenterDrivenPlan.shots[0]?.sourceRefs, ['presenter-enterprise-1']);
assert.deepEqual(presenterDrivenPlan.shots[0]?.digitalHumanPlan, {
  workflow: 'material_processing', method: 'talking', presenterAssetIds: ['presenter-enterprise-1'],
  referenceMaterialIds: [],
  referenceRequired: false, candidateTools: ['heygen'], executionState: 'ready_for_capability_check', accountPresenterLock: presenterLock,
});
assert.equal(presenterDrivenPlan.accountPresenterLock?.consistencyKey, presenterLock.consistencyKey);

const viralPresenterPlan = createSocialAssetSupplyPlan({
  creationMode: 'viral_replication',
  confirmedFactRefs: ['fact-product-name'],
  inventory: { presenterAssetIds: ['presenter-enterprise-1'], referenceVideoIds: ['reference-video-1'] },
  accountPresenterLock: presenterLock,
  shots: [{ shotId: 'reference-hook', function: 'hook', requestedDescription: '逐句复刻参考镜头节奏并替换人物' }],
});
assert.deepEqual(viralPresenterPlan.shots[0]?.digitalHumanPlan, {
  workflow: 'viral_replication', method: 'replace', presenterAssetIds: ['presenter-enterprise-1'], referenceMaterialIds: ['reference-video-1'],
  referenceRequired: true, candidateTools: ['local_head_pipeline', 'runway_kling_motion'], executionState: 'preview_only', accountPresenterLock: presenterLock,
});

const truthSensitivePlan = createSocialAssetSupplyPlan({
  creationMode: 'viral_replication',
  assetAvailability: 'none',
  confirmedFactRefs: ['fact-product-name', 'fact-parameter'],
  shots: [
    { shotId: 'factory', function: 'trust', truthSensitiveSubject: 'customer_factory' },
    { shotId: 'case', function: 'proof', truthSensitiveSubject: 'customer_case' },
    { shotId: 'effect', function: 'demonstration', truthSensitiveSubject: 'product_effect' },
  ],
});

assert.equal(truthSensitivePlan.status, 'ready');
assert.equal(truthSensitivePlan.overallFeasibility, 'functional_equivalent');
assert.equal(truthSensitivePlan.canProduceWithoutCustomerShoot, true);
for (const shot of truthSensitivePlan.shots) {
  assert.equal(shot.functionalEquivalentReplacement.required, true);
  assert.equal(shot.truthBoundary.mustNotImplyCustomerReality, true);
  assert.equal(shot.truthBoundary.customerEvidenceRequired, false);
  assert.deepEqual(shot.truthBoundary.customerEvidenceRefs, []);
  assert.notEqual(shot.sourceStrategy, 'customer_real_asset');
  assert.match(shot.functionalEquivalentReplacement.reason ?? '', /缺少.*真实场景或结果/);
  assert.equal(shot.feasibility, 'functional_equivalent');
}
assert.ok(truthSensitivePlan.shots[0]?.truthBoundary.prohibitedRepresentations.includes('depict_generated_factory_as_customer_factory'));
assert.ok(truthSensitivePlan.shots[1]?.truthBoundary.prohibitedRepresentations.includes('invent_customer_case_or_results'));
assert.ok(truthSensitivePlan.shots[2]?.truthBoundary.prohibitedRepresentations.includes('depict_generated_effect_as_verified_product_result'));
assert.match(truthSensitivePlan.shots[0]?.productionInstruction ?? '', /不生成或暗示客户真实工厂/);
assert.match(truthSensitivePlan.shots[1]?.productionInstruction ?? '', /不虚构客户身份、案例和结果/);
assert.match(truthSensitivePlan.shots[2]?.productionInstruction ?? '', /不生成可被误认成真实效果/);

const evidenceBackedPlan = createSocialAssetSupplyPlan({
  creationMode: 'viral_replication',
  confirmedFactRefs: ['fact-factory'],
  inventory: { factoryEvidenceAssetIds: ['factory-video-1'] },
  shots: [
    { shotId: 'factory-proof', function: 'trust', truthSensitiveSubject: 'customer_factory' },
  ],
});

assert.equal(evidenceBackedPlan.assetAvailability, 'ready');
assert.equal(evidenceBackedPlan.productionRoute, 'real_asset_enhancement');
assert.equal(evidenceBackedPlan.shots[0]?.sourceStrategy, 'customer_real_asset');
assert.deepEqual(evidenceBackedPlan.shots[0]?.sourceRefs, ['factory-video-1']);
assert.equal(evidenceBackedPlan.shots[0]?.functionalEquivalentReplacement.required, false);
assert.equal(evidenceBackedPlan.shots[0]?.truthBoundary.customerEvidenceRequired, true);
assert.equal(evidenceBackedPlan.shots[0]?.feasibility, 'full_fidelity');

const productAnchoredPlan = createSocialAssetSupplyPlan({
  creationMode: 'material_processing',
  confirmedFactRefs: ['fact-product'],
  inventory: {
    productIdentityGroups: [
      { productRef: 'serum', imageIds: ['serum-front', 'serum-side'] },
      { productRef: 'cream', imageIds: ['cream-front'] },
    ],
  },
});
assert.equal(productAnchoredPlan.assetAvailability, 'limited');
assert.equal(productAnchoredPlan.productionRoute, 'product_anchored_generation');
assert.equal(productAnchoredPlan.overallFeasibility, 'full_fidelity');
assert.ok(productAnchoredPlan.shots.every(shot => shot.sourceStrategy === 'aigc_product_scene_replication'));
assert.ok(productAnchoredPlan.shots.every(shot => /完整场景拓扑|同一场景模板/.test(shot.productionInstruction)));
assert.equal(productAnchoredPlan.shots[0]?.productSceneReplication?.sceneTemplateKey, 'system:clean-platform-orbit-v1');
assert.equal(productAnchoredPlan.shots[0]?.productSceneReplication?.sceneLock.productSlots.length, 2);
assert.equal(productAnchoredPlan.shots[0]?.productSceneReplication?.productIdentity.groups[0]?.referenceImageIds.length, 2);
assert.match(productAnchoredPlan.shots[0]?.productSceneReplication?.cameraLock.movementPath || '', /环绕/);

const factsPendingPlan = createSocialAssetSupplyPlan({ creationMode: 'material_processing' });
assert.equal(factsPendingPlan.status, 'requires_fact_confirmation');
assert.deepEqual(factsPendingPlan.customerActions, ['confirm_facts']);
assert.equal(factsPendingPlan.overallFeasibility, 'blocked_for_facts_or_rights');
assert.equal(factsPendingPlan.canProduceWithoutCustomerShoot, false);

const blockedProofPlan = createSocialAssetSupplyPlan({
  creationMode: 'viral_replication',
  shots: [{ shotId: 'factory-proof', function: 'trust', truthSensitiveSubject: 'customer_factory' }],
});
assert.equal(blockedProofPlan.overallFeasibility, 'blocked_for_facts_or_rights');
assert.equal(blockedProofPlan.shots[0]?.feasibility, 'blocked_for_facts_or_rights');
assert.equal(blockedProofPlan.canProduceWithoutCustomerShoot, false);

console.log('social content asset supply tests passed');
