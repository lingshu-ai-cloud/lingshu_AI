import assert from 'node:assert/strict';
import test from 'node:test';
import { createSocialAssetSupplyPlan } from './socialContentAssetSupply';
import { normalizeSceneVisualContract } from './sceneVisualContract';

const inventory = { customerVideoIds: ['owned-video'], productIdentityGroups: [
  { productRef: 'current-sku', imageIds: ['current-image'] },
] };
const foreignReference = normalizeSceneVisualContract({
  subjects: ['product'],
  interaction: { kind: 'product_only_display', description: '产品包装特写' },
  productRef: 'benchmark-sku', productPolicy: 'preferred',
});
const segment = { sourceRef: 'owned-video', segmentId: 'verified-segment', startSeconds: 0, endSeconds: 4 };

function route(policyVersion: 'type-aware.v1' | 'type-aware.v2', matchProductRef: string) {
  return createSocialAssetSupplyPlan({
    creationMode: 'viral_replication', productionApproach: 'ai_enhanced',
    materialRoutingPolicyVersion: policyVersion, inventory,
    shots: [{ shotId: 'current-product-shot', function: 'demonstration', materialType: 'product',
      productPolicy: 'locked', productRef: 'current-sku', visualContract: foreignReference,
      localVideoMatch: { sourceRefs: ['owned-video'], semanticMatch: 'verified', evidenceRef: 'analyzed-owned-segment',
        sourceTier: 'product_local', productRef: matchProductRef },
      selectedMaterialSegment: segment }],
  }).shots[0]!;
}

test('reference product cannot override the current selected product in typed local routing', () => {
  for (const version of ['type-aware.v1', 'type-aware.v2'] as const) {
    const foreign = route(version, 'benchmark-sku');
    assert.equal(foreign.materialRouting?.localMatch.state, 'missing');
    assert.deepEqual(foreign.materialRouting?.localMatch.sourceRefs, []);
    assert.deepEqual(foreign.sourceRefs, []);
    assert.equal(foreign.selectedMaterialSegment, undefined);

    const current = route(version, 'current-sku');
    assert.equal(current.materialRouting?.localMatch.state, 'matched');
    assert.deepEqual(current.sourceRefs, ['owned-video']);
    assert.deepEqual(current.selectedMaterialSegment, segment);
  }
});
