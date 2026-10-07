import assert from 'node:assert/strict';
import { buildPresetMatrixVideoPlans, buildPresetVideoPlans, WEEKLY_TASK_PACKAGE_PRESETS } from './weeklyTaskPackagePresets.js';

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

const matrixPlans = buildPresetMatrixVideoPlans({
  preset: WEEKLY_TASK_PACKAGE_PRESETS[0]!,
  productName: '检测设备',
  matrixRows: [
    { accountId: 'yt', platform: 'youtube', audience: '采购商', productName: '检测设备', language: 'en', objective: '验证', contentDirection: '采购问题', cta: '询盘', weeklyCount: 3, sourceProjectIds: [] },
    { accountId: 'tt', platform: 'tiktok', audience: '采购商', productName: '检测设备', language: 'en', objective: '验证', contentDirection: '采购问题', cta: '询盘', weeklyCount: 5, sourceProjectIds: [] },
    { accountId: 'ig', platform: 'instagram', audience: '采购商', productName: '检测设备', language: 'en', objective: '验证', contentDirection: '采购问题', cta: '询盘', weeklyCount: 5, sourceProjectIds: [] },
    { accountId: 'fb', platform: 'facebook', audience: '采购商', productName: '检测设备', language: 'en', objective: '验证', contentDirection: '采购问题', cta: '询盘', weeklyCount: 5, sourceProjectIds: [] },
  ],
  idFactory: (() => { let id = 0; return () => `content-${++id}`; })(),
});
assert.equal(matrixPlans.length, 18, 'actual weekly video tasks must equal the sum of account matrix quotas');
assert.deepEqual(Object.fromEntries(['youtube', 'tiktok', 'instagram', 'facebook'].map(platform => [platform, matrixPlans.filter(plan => plan.platform === platform).length])), {
  youtube: 3, tiktok: 5, instagram: 5, facebook: 5,
});
assert.equal(new Set(matrixPlans.map(plan => plan.contentId)).size, matrixPlans.length, 'every matrix task needs an independent content identity');

console.log('weekly task package preset tests passed');
