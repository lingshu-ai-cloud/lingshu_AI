import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultFacebookPromotionPlans } from './defaultFacebookPromotion';
import { defaultWeeklyGoal } from './defaultWeeklyGoal';
import { normalizeDigitalEmployeeConfig } from '../../server/digitalEmployees/domain';

test('future weekly plans attach the US$5 assumption only to Facebook content', () => {
  assert.deepEqual(defaultFacebookPromotionPlans([
    { contentId: 'fb-1', platform: 'facebook' },
    { contentId: 'li-1', platform: 'linkedin' },
    { contentId: 'fb-2', platform: 'facebook' },
    { platform: 'facebook' },
  ]), [{ contentId: 'fb-1', budgetCny: 36 }, { contentId: 'fb-2', budgetCny: 36 }]);
});

test('assistant weekly-goal generation persists the per-content Facebook default without changing output count', () => {
  const config = normalizeDigitalEmployeeConfig({ focusProducts: '产品', socialOperatingProfile: 'starter_four_platform' });
  const goal = defaultWeeklyGoal(config, 'full_funnel', 'facebook').draft;
  assert.equal(goal.videoPlans?.length, 5);
  assert.equal(goal.promotionPlans?.length, 5);
  assert.equal(goal.promotionPlans?.reduce((sum, plan) => sum + plan.budgetCny, 0), 180);
});

test('default weekly outline is 15 provisional Facebook and LinkedIn publications independent of account quotas', () => {
  const config = normalizeDigitalEmployeeConfig({ focusProducts: '产品', publishingTargets: [
    { platform: 'facebook', accountId: 'fb', accountLabel: 'FB', weeklyCount: 2 },
  ] });
  const goal = defaultWeeklyGoal(config).draft;
  assert.deepEqual(goal.contentPlatforms, ['facebook', 'linkedin']);
  assert.equal(goal.target, 15);
  assert.deepEqual(goal.videoPlans, []);
});
