import assert from 'node:assert/strict';
import test from 'node:test';
import { getAdPlanCapability } from './platformAdCapabilities';

test('single Meta plan supports managed video creation but CPC optimization only for traffic', () => {
  const plan = { channels: ['Facebook', 'Instagram'], currency: 'CNY', goal: '提升有效视频观看' };
  assert.equal(getAdPlanCapability(plan).supportsManaged, true);
  assert.equal(getAdPlanCapability(plan).supportsCpcOptimization, false);
  assert.equal(getAdPlanCapability({ ...plan, goal: '提升网站访问' }).supportsCpcOptimization, true);
});
test('mixed providers, unknown channels and unsupported goals never advertise creation or management', () => {
  for (const channels of [[], ['Facebook', 'TikTok'], ['YouTube', 'TikTok'], ['unknown']]) {
    const capability = getAdPlanCapability({ channels, currency: 'USD', goal: '提升有效视频观看' });
    assert.equal(capability.supportsCreate, false);
    assert.equal(capability.supportsManaged, false);
  }
  assert.equal(getAdPlanCapability({ channels: ['Facebook'], currency: 'USD', goal: '获取线索或转化' }).supportsCreate, false);
});
test('TikTok Spark and Google Demand Gen remain manual and USD only', () => {
  for (const plan of [{ channels: ['TikTok'], goal: '提升有效视频观看' }, { channels: ['YouTube'], goal: '获取线索或转化' }]) {
    assert.equal(getAdPlanCapability({ ...plan, currency: 'USD' }).supportsCreate, true);
    assert.equal(getAdPlanCapability({ ...plan, currency: 'USD' }).supportsApproval, false);
    assert.equal(getAdPlanCapability({ ...plan, currency: 'CNY' }).supportsCreate, false);
  }
  assert.equal(getAdPlanCapability({ channels: ['YouTube'], goal: '提升有效视频观看', currency: 'USD' }).supportsCreate, false);
});
