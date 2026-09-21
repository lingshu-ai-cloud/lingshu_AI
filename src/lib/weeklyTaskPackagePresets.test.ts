import assert from 'node:assert/strict';
import { buildPresetVideoPlans, WEEKLY_TASK_PACKAGE_PRESETS } from './weeklyTaskPackagePresets.js';

assert.deepEqual(WEEKLY_TASK_PACKAGE_PRESETS.map(item => item.label), [
  'B2B 从零起步',
  'B2B 已有基础',
  '品牌影响',
  'DTC 直接销售',
]);
for (const preset of WEEKLY_TASK_PACKAGE_PRESETS) {
  const plans = buildPresetVideoPlans({ preset, productName: '测试产品', focus: '验证东南亚采购商反馈' });
  assert.equal(plans.length, preset.weeklyOutput);
  assert.equal(plans[0]?.platform, preset.primaryPlatform);
  assert.equal(plans.every(plan => plan.productName === '测试产品' && plan.theme.includes('验证东南亚采购商反馈')), true);
  assert.equal(plans.every(plan => preset.platforms.includes(plan.platform)), true);
}

console.log('weekly task package preset tests passed');
