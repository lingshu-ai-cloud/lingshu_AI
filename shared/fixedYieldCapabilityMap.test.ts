import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultFixedYieldProductionMode,
  fixedYieldCapabilityIssues,
  fixedYieldPathForMaterialType,
  FIXED_YIELD_CAPABILITY_MAP,
} from './fixedYieldCapabilityMap.js';

test('capability map covers every current archetype once and excludes future generation modes', () => {
  assert.deepEqual(fixedYieldCapabilityIssues(), []);
  assert.deepEqual(FIXED_YIELD_CAPABILITY_MAP.P2_PRODUCT_REAL.productionModes, ['local_video_match']);
  assert.deepEqual(FIXED_YIELD_CAPABILITY_MAP.P5_GENERAL_EVIDENCE.productionModes, ['local_video_match']);
  assert.equal(JSON.stringify(FIXED_YIELD_CAPABILITY_MAP).includes('i2v'), false);
  assert.equal(JSON.stringify(FIXED_YIELD_CAPABILITY_MAP).includes('motion_graphics'), false);
});

test('material type and presenter archetype select one deterministic current route', () => {
  assert.equal(fixedYieldPathForMaterialType('factory'), 'P3_FACTORY_REAL');
  assert.equal(fixedYieldPathForMaterialType('unknown'), null);
  assert.equal(defaultFixedYieldProductionMode('P1C_SHELF_STAND_TALK'), 'pipeline_1');
  assert.equal(defaultFixedYieldProductionMode('P1D_SHELF_ACTION_TALK'), 'pipeline_2');
  assert.equal(defaultFixedYieldProductionMode('P2C_PACKAGE_DETAIL'), 'local_video_match');
});
