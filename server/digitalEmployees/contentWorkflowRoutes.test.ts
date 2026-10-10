import assert from 'node:assert/strict';
import test from 'node:test';
import { enabledRoutes } from './contentProduction.js';
test('explicit independent production workflows map to executable routes without publishing permission', () => {
  assert.deepEqual(enabledRoutes({ enabledWorkflows: ['product_content'] }), ['product']);
  assert.deepEqual(enabledRoutes({ enabledWorkflows: ['material_content'] }), ['material']);
  assert.deepEqual(enabledRoutes({ enabledWorkflows: ['viral_clone'] }), ['clone']);
  assert.deepEqual(enabledRoutes({ enabledWorkflows: ['product_content', 'material_content', 'viral_clone'] }), ['clone', 'product', 'material']);
  assert.deepEqual(enabledRoutes({ enabledWorkflows: ['content_publish'] }), []);
});
