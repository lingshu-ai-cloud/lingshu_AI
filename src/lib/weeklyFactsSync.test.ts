import assert from 'node:assert/strict';
import test from 'node:test';
import type { DigitalEmployeeOverview } from './digitalEmployees';
import { synchronizeWeeklyPlanFacts } from './weeklyFactsSync';

const goal = { id: 'goal-a', version: 3 };
const recovery = {
  recoveryAction: 'rebuild_weekly_goal', expectedGoalVersion: 3,
  sourcePlanId: 'plan-a', expectedFactsVersion: 'facts-v1',
  expectedSourcePlanDigest: 'a'.repeat(64),
};
const updated = { goal: { id: 'goal-b' }, plan: { status: 'draft', businessPackage: { revision: 1 } }, run: null } as DigitalEmployeeOverview;

test('syncs only the guarded draft and returns it for fresh confirmation', async () => {
  let calls = 0;
  const result = await synchronizeWeeklyPlanFacts(goal, recovery, async (goalId, input) => {
    calls += 1;
    assert.equal(goalId, goal.id);
    assert.equal(input.expectedGoalVersion, goal.version);
    assert.equal(input.sourcePlanId, recovery.sourcePlanId);
    return updated;
  });
  assert.equal(calls, 1);
  assert.equal(result, updated);
});

test('stale or incomplete recovery evidence never submits a rebuild', async () => {
  let calls = 0;
  const rebuild = async () => { calls += 1; return updated; };
  await assert.rejects(() => synchronizeWeeklyPlanFacts(goal, { ...recovery, expectedGoalVersion: 2 }, rebuild), /invalid_enterprise_facts_rebuild_target/);
  assert.equal(calls, 0);
  await assert.rejects(() => synchronizeWeeklyPlanFacts(goal, recovery, async () => ({ goal: { id: 'goal-b' } } as DigitalEmployeeOverview)), /新版周计划尚未完整/);
  await assert.rejects(() => synchronizeWeeklyPlanFacts(goal, recovery, async () => ({ ...updated, goal } as DigitalEmployeeOverview)), /新版周计划尚未完整/);
});
