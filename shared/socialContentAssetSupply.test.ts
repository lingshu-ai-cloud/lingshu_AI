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
  assert.equal(shot.functionalEquivalentReplacement.required, false);
  assert.equal(shot.truthBoundary.mustNotImplyCustomerReality, true);
  assert.equal(shot.truthBoundary.customerEvidenceRequired, false);
  assert.deepEqual(shot.truthBoundary.customerEvidenceRefs, []);
  assert.notEqual(shot.sourceStrategy, 'customer_real_asset');
  assert.equal(shot.feasibility, 'functional_equivalent');
}
assert.ok(truthSensitivePlan.shots[0]?.truthBoundary.prohibitedRepresentations.includes('depict_generated_factory_as_customer_factory'));
assert.ok(truthSensitivePlan.shots[1]?.truthBoundary.prohibitedRepresentations.includes('invent_customer_case_or_results'));
assert.ok(truthSensitivePlan.shots[2]?.truthBoundary.prohibitedRepresentations.includes('depict_generated_effect_as_verified_product_result'));

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
assert.equal(evidenceBackedPlan.shots[0]?.truthBoundary.customerEvidenceRequired, false);
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
  shots: [{ shotId: 'product-only', function: 'demonstration', requestedDescription: '纯产品包装在展台环绕展示' }],
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
assert.equal(factsPendingPlan.status, 'ready');
assert.deepEqual(factsPendingPlan.customerActions, []);
assert.equal(factsPendingPlan.overallFeasibility, 'functional_equivalent');
assert.equal(factsPendingPlan.canProduceWithoutCustomerShoot, true);

const blockedProofPlan = createSocialAssetSupplyPlan({
  creationMode: 'viral_replication',
  shots: [{ shotId: 'factory-proof', function: 'trust', truthSensitiveSubject: 'customer_factory' }],
});
assert.equal(blockedProofPlan.overallFeasibility, 'functional_equivalent');
assert.equal(blockedProofPlan.shots[0]?.feasibility, 'functional_equivalent');
assert.equal(blockedProofPlan.canProduceWithoutCustomerShoot, true);

const hybridRouteMatrix = createSocialAssetSupplyPlan({
  creationMode: 'viral_replication',
  productionApproach: 'ai_enhanced',
  rightsConfirmationRequired: true,
  inventory: {
    customerVideoIds: ['general-video'],
    factoryEvidenceAssetIds: ['factory-video'],
    customerCaseEvidenceAssetIds: ['case-video'],
    productEffectEvidenceAssetIds: ['effect-video'],
    presenterAssetIds: ['presenter-enterprise-1'],
    referenceVideoIds: ['reference-video-1'],
    productIdentityGroups: [{ productRef: 'serum-a', imageIds: ['serum-front'] }],
  },
  accountPresenterLock: presenterLock,
  shots: [
    { shotId: 'factory-person', function: 'trust', requestedDescription: '员工在工厂产线上检查设备', truthSensitiveSubject: 'customer_factory' },
    { shotId: 'case', function: 'proof', requestedDescription: '客户案例画面', truthSensitiveSubject: 'customer_case' },
    { shotId: 'face', function: 'demonstration', requestedDescription: '人物打开精华并涂抹上脸', truthSensitiveSubject: 'product_effect' },
    { shotId: 'person', function: 'value', requestedDescription: '人物对镜口播' },
    { shotId: 'product', function: 'demonstration', requestedDescription: '纯产品瓶体特写旋转展示' },
    { shotId: 'general', function: 'transition', requestedDescription: '生活方式环境转场' },
  ],
});
assert.equal(hybridRouteMatrix.status, 'ready', '已入库素材不因 rights 字段阻断');
assert.deepEqual(hybridRouteMatrix.customerActions, []);
assert.equal(hybridRouteMatrix.shots[0]?.sourceStrategy, 'customer_real_asset');
assert.deepEqual(hybridRouteMatrix.shots[0]?.sourceRefs, ['factory-video']);
assert.equal(hybridRouteMatrix.shots[1]?.sourceStrategy, 'customer_real_asset');
assert.deepEqual(hybridRouteMatrix.shots[1]?.sourceRefs, ['case-video']);
assert.equal(hybridRouteMatrix.shots[2]?.sourceStrategy, 'authorized_digital_presenter');
assert.equal(hybridRouteMatrix.shots[2]?.productSceneReplication?.productIdentity.groups[0]?.productRef, 'serum-a');
assert.equal(hybridRouteMatrix.shots[3]?.sourceStrategy, 'authorized_digital_presenter');
assert.equal(hybridRouteMatrix.shots[4]?.sourceStrategy, 'aigc_product_scene_replication');
assert.equal(hybridRouteMatrix.shots[5]?.sourceStrategy, 'customer_real_asset');
assert.equal(hybridRouteMatrix.shots[2]?.fallbackSourceStrategy, null, '复杂数字人镜头不得用图形卡片伪装成功');

const freeRoute = createSocialAssetSupplyPlan({
  creationMode: 'viral_replication',
  productionApproach: 'material_cut',
  inventory: { customerVideoIds: ['general-video'], factoryEvidenceAssetIds: ['factory-video'] },
  shots: [
    { shotId: 'free-factory', function: 'trust', requestedDescription: '人物在工厂工作', truthSensitiveSubject: 'customer_factory' },
    { shotId: 'free-person', function: 'demonstration', requestedDescription: '人物使用产品' },
  ],
});
assert.ok(freeRoute.shots.every(shot => shot.sourceStrategy === 'customer_real_asset'));
assert.deepEqual(freeRoute.shots[0]?.sourceRefs, ['factory-video']);
assert.deepEqual(freeRoute.shots[1]?.sourceRefs, ['general-video']);
assert.ok(freeRoute.shots.every(shot => !shot.digitalHumanPlan && !shot.productSceneReplication));

const lockedMissingProduct = createSocialAssetSupplyPlan({
  creationMode: 'material_processing', productionApproach: 'ai_enhanced',
  inventory: { productIdentityGroups: [{ productRef: 'serum-a', imageIds: ['serum-front'] }] },
  shots: [{ shotId: 'locked-product', function: 'demonstration', requestedDescription: '纯产品展示',
    productPolicy: 'locked', productRef: 'cream-b' }],
});
assert.equal(lockedMissingProduct.shots[0]?.productSceneReplication?.productIdentity.groups.length, 0);
assert.equal(lockedMissingProduct.shots[0]?.feasibility, 'goal_degraded', '只有 locked 产品不允许异品替换');

const preferredMissingProduct = createSocialAssetSupplyPlan({
  creationMode: 'material_processing', productionApproach: 'ai_enhanced',
  inventory: { productIdentityGroups: [{ productRef: 'serum-a', imageIds: ['serum-front'] }] },
  shots: [{ shotId: 'preferred-product', function: 'demonstration', requestedDescription: '纯产品展示',
    productPolicy: 'preferred', productRef: 'cream-b' }],
});
assert.equal(preferredMissingProduct.shots[0]?.productSceneReplication?.productIdentity.groups[0]?.productRef, 'serum-a');
assert.equal(preferredMissingProduct.shots[0]?.feasibility, 'full_fidelity', 'preferred/open 应使用库内可用产品而不阻断');

const lockedPersonProductWithoutReference = createSocialAssetSupplyPlan({
  creationMode: 'material_processing', productionApproach: 'ai_enhanced',
  inventory: { presenterAssetIds: ['presenter-enterprise-1'] },
  accountPresenterLock: presenterLock,
  shots: [{ shotId: 'locked-person-product', function: 'demonstration',
    requestedDescription: '人物将指定精华涂抹上脸', productPolicy: 'locked', productRef: 'serum-a' }],
});
assert.equal(lockedPersonProductWithoutReference.shots[0]?.sourceStrategy, 'authorized_digital_presenter');
assert.equal(lockedPersonProductWithoutReference.shots[0]?.productSceneReplication, undefined,
  '没有产品参考图时不得创建伪空的产品 IAIGC 规格');
assert.equal(lockedPersonProductWithoutReference.shots[0]?.feasibility, 'functional_equivalent',
  '没有产品图不应成为内容制作硬阻断');

const productOnlyWithoutReference = createSocialAssetSupplyPlan({
  creationMode: 'material_processing', productionApproach: 'ai_enhanced',
  inventory: { customerVideoIds: ['general-video'] },
  shots: [{ shotId: 'open-product', function: 'demonstration',
    requestedDescription: '纯产品瓶体旋转展示', productPolicy: 'open' }],
});
assert.equal(productOnlyWithoutReference.shots[0]?.sourceStrategy, 'customer_real_asset',
  '没有产品参考图时应使用现有素材，不得构造不可执行的产品 IAIGC');
assert.equal(productOnlyWithoutReference.shots[0]?.productSceneReplication, undefined);

const productOnlyWithNoUsableMedia = createSocialAssetSupplyPlan({
  creationMode: 'material_processing', productionApproach: 'ai_enhanced',
  shots: [{ shotId: 'open-product-empty', function: 'demonstration',
    requestedDescription: '纯产品瓶体旋转展示', productPolicy: 'open' }],
});
assert.equal(productOnlyWithNoUsableMedia.status, 'ready');
assert.equal(productOnlyWithNoUsableMedia.shots[0]?.productSceneReplication, undefined);
assert.equal(productOnlyWithNoUsableMedia.shots[0]?.feasibility, 'functional_equivalent',
  '无产品参考图只能降级使用现有能力，不能创建空 IAIGC 规格或硬阻断');

console.log('social content asset supply tests passed');
