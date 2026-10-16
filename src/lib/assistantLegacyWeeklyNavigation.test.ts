import assert from 'node:assert/strict';
import test from 'node:test';
import { readLegacyWeeklyPlanNavigation } from './assistantLegacyWeeklyNavigation';
test('legacy week query identifies exact actual goal and plan without activating any task', () => {
  assert.deepEqual(readLegacyWeeklyPlanNavigation('?page=digitalEmployees&goalId=goal_real&planId=plan-1'), { goalId: 'goal_real', planId: 'plan-1' });
  assert.equal(readLegacyWeeklyPlanNavigation('?page=digitalEmployees&goalId=goal_real'), null);
  assert.equal(readLegacyWeeklyPlanNavigation('?page=smartAssets&goalId=goal&planId=plan'), null);
  assert.equal(readLegacyWeeklyPlanNavigation('?page=digitalEmployees&weeklyView=production&goalId=goal&planId=plan'), null);
  assert.equal(readLegacyWeeklyPlanNavigation('?page=digitalEmployees&goalId=%3Cscript%3E&planId=plan'), null);
  assert.equal(readLegacyWeeklyPlanNavigation('?page=digitalEmployees&goalId=..%2Fother&planId=plan'), null);
});
