import test from 'node:test';
import assert from 'node:assert/strict';
import { executableMaterialRouting } from './socialContentProductReplacementEnvironment.js';
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
