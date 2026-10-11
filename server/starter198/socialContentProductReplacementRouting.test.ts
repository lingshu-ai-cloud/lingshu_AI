import test from 'node:test';
import assert from 'node:assert/strict';
import { executableMaterialRouting, productReferenceBound } from './socialContentProductReplacementEnvironment.js';
import { socialRequestHash } from './socialContentValidation.js';

const routing = {
  schemaVersion: 'social-material-routing.v1',
  materialType: 'product',
  policy: 'local_first_product_i2v',
  generation: {
    videoProvider: 'wan', videoModel: 'wan2.6-i2v-flash', durationSeconds: 3.6,
    durationOrigin: 'planned_timeline', productImageRefs: ['enterprise-product'],
  },
};

test('execution routing ignores duration provenance but keeps paid provider inputs frozen', () => {
  const projected = {...routing, generation: {...routing.generation, durationOrigin: 'explicit_frozen'}};
  assert.equal(socialRequestHash(executableMaterialRouting(routing)), socialRequestHash(executableMaterialRouting(projected)));
  const changed = {...projected, generation: {...projected.generation, durationSeconds: 4}};
  assert.notEqual(socialRequestHash(executableMaterialRouting(routing)), socialRequestHash(executableMaterialRouting(changed)));
});

test('budget preflight binds canonical product bytes while runtime references require the exact hash', () => {
  assert.equal(productReferenceBound([], 'product-image', 'a'.repeat(64)), true);
  assert.equal(productReferenceBound([{assetId: 'product-image', productRef: 'product:p', url: '/owned',
    contentHash: 'a'.repeat(64)}], 'product-image', 'a'.repeat(64)), true);
  assert.equal(productReferenceBound([{assetId: 'product-image', productRef: 'product:p', url: '/owned',
    contentHash: 'b'.repeat(64)}], 'product-image', 'a'.repeat(64)), false);
});
