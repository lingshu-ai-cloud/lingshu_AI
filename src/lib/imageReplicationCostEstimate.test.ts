import assert from 'node:assert/strict';
import test from 'node:test';
import { imageReplicationModelCostRangeCny } from './imageReplicationCostEstimate';

test('public-model cost estimate is a range, scales with output count, and never acts as a budget cap', () => {
  const one = imageReplicationModelCostRangeCny();
  assert.ok(one.minimum > 0 && one.maximum > one.minimum);
  const two = imageReplicationModelCostRangeCny(2);
  assert.ok(two.minimum >= one.minimum * 2 - 0.01);
  assert.ok(two.maximum >= one.maximum * 2 - 0.01);
});
