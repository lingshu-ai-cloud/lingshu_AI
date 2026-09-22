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
assert.equal(zeroAssetPlan.canProduceWithoutCustomerShoot, true);
assert.ok(zeroAssetPlan.shots.length >= 4);
assert.ok(zeroAssetPlan.shots.every(shot => shot.customerShootRequired === false));
assert.equal(zeroAssetPlan.shots[0]?.sourceStrategy, 'authorized_digital_presenter');
assert.ok(zeroAssetPlan.shots.every(shot => shot.sourceStrategy !== 'customer_real_asset'));

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
assert.equal(truthSensitivePlan.canProduceWithoutCustomerShoot, true);
for (const shot of truthSensitivePlan.shots) {
  assert.equal(shot.functionalEquivalentReplacement.required, true);
  assert.equal(shot.truthBoundary.mustNotImplyCustomerReality, true);
  assert.equal(shot.truthBoundary.customerEvidenceRequired, false);
  assert.deepEqual(shot.truthBoundary.customerEvidenceRefs, []);
  assert.notEqual(shot.sourceStrategy, 'customer_real_asset');
  assert.match(shot.functionalEquivalentReplacement.reason ?? '', /缺少.*真实场景或结果/);
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

const productAnchoredPlan = createSocialAssetSupplyPlan({
  creationMode: 'material_processing',
  confirmedFactRefs: ['fact-product'],
  inventory: { productImageIds: ['product-image-1'] },
});
assert.equal(productAnchoredPlan.assetAvailability, 'limited');
assert.equal(productAnchoredPlan.productionRoute, 'product_anchored_generation');
assert.ok(productAnchoredPlan.shots.every(shot => shot.sourceStrategy === 'customer_product_image_animation'));
assert.ok(productAnchoredPlan.shots.every(shot => /锁定产品外观、包装、商标和文字/.test(shot.productionInstruction)));

const factsPendingPlan = createSocialAssetSupplyPlan({ creationMode: 'material_processing' });
assert.equal(factsPendingPlan.status, 'requires_fact_confirmation');
assert.deepEqual(factsPendingPlan.customerActions, ['confirm_facts']);
assert.equal(factsPendingPlan.canProduceWithoutCustomerShoot, true);

console.log('social content asset supply tests passed');
