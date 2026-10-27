import assert from 'node:assert/strict';
import test from 'node:test';
import { ONBOARDING_BUYER_OPTIONS, ONBOARDING_MARKET_OPTIONS, onboardingSelections, onboardingSelectionText } from './onboardingMarketOptions';

test('onboarding provides common markets and buyer types without preselecting facts', () => {
  assert.ok(ONBOARDING_MARKET_OPTIONS.some(option => option.value === '美国'));
  assert.ok(ONBOARDING_MARKET_OPTIONS.some(option => option.value === '东南亚'));
  assert.ok(ONBOARDING_BUYER_OPTIONS.some(option => option.value === '采购负责人'));
  assert.deepEqual(onboardingSelections(''), []);
});

test('multiple selections round-trip through the existing draft string contract', () => {
  assert.equal(onboardingSelectionText(['美国', '加拿大', '美国', '']), '美国、加拿大');
  assert.deepEqual(onboardingSelections('美国、加拿大'), ['美国', '加拿大']);
  assert.deepEqual(onboardingSelections('进口商，采购负责人;品牌商'), ['进口商', '采购负责人', '品牌商']);
  assert.deepEqual(onboardingSelections('当地经销商与采购负责人'), ['当地经销商与采购负责人']);
  assert.equal(onboardingSelectionText(['自定义市场']), '自定义市场');
});
