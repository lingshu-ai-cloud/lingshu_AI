import assert from 'node:assert/strict';
import test from 'node:test';
import { DigitalEmployeeApiError } from './digitalEmployeeApi';
import type { DigitalEmployeeOverview } from './digitalEmployees';
import { confirmedWeeklyExecution, weeklyStartConflictFromError, weeklyStartResultNeedsReconciliation } from './weeklyStartValidation';

function overview(goalId: string, runId: string, startedAt: string, taskRunId = runId): DigitalEmployeeOverview {
  return {
    run: { id: runId, goal_id: goalId, started_at: startedAt },
    tasks: [{ id: 'task-1', run_id: taskRunId }],
  } as DigitalEmployeeOverview;
}

test('a launch receipt requires a matching goal, valid persisted start and matching tasks', () => {
  const valid = overview('goal-1', 'run-1', '2026-10-23T08:00:00.000Z');
  assert.equal(confirmedWeeklyExecution(valid, 'goal-1')?.run.id, 'run-1');
  assert.equal(confirmedWeeklyExecution(valid, 'goal-2'), null);
  assert.equal(confirmedWeeklyExecution(overview('goal-1', 'run-1', 'not-a-date'), 'goal-1'), null);
  assert.equal(confirmedWeeklyExecution(overview('goal-1', 'run-1', '2026-10-23T08:00:00.000Z', 'other-run'), 'goal-1'), null);
  assert.equal(confirmedWeeklyExecution({ ...valid, run: null } as DigitalEmployeeOverview, 'goal-1'), null);
});

test('active-goal conflict uses server identities and never invents a conflicting run', () => {
  const conflict = new DigitalEmployeeApiError(409, 'active_goal_exists', 'occupied', {
    activeGoalId: ' goal-2 ', activeRunId: ' run-2 ', activeGoalTitle: '另一轮计划', activeRunStatus: 'running',
  });
  assert.deepEqual(weeklyStartConflictFromError(conflict), {
    goalId: 'goal-2', runId: 'run-2', goalTitle: '另一轮计划', goalStatus: '', runStatus: 'running', startsAt: '', endsAt: '',
  });
  assert.equal(weeklyStartConflictFromError(new DigitalEmployeeApiError(409, 'active_goal_exists', 'occupied', {})), null);
  assert.equal(weeklyStartConflictFromError(new DigitalEmployeeApiError(409, 'request_failed', 'occupied', { activeRunId: 'run-2' })), null);
});

test('only uncertain launch responses justify one read-only reconciliation', () => {
  assert.equal(weeklyStartResultNeedsReconciliation(new Error('network failed')), true);
  assert.equal(weeklyStartResultNeedsReconciliation(new DigitalEmployeeApiError(408, 'timeout', 'timeout', {})), true);
  assert.equal(weeklyStartResultNeedsReconciliation(new DigitalEmployeeApiError(503, 'provider', 'unavailable', {})), true);
  assert.equal(weeklyStartResultNeedsReconciliation(new DigitalEmployeeApiError(409, 'active_goal_exists', 'occupied', {})), false);
  assert.equal(weeklyStartResultNeedsReconciliation(new DigitalEmployeeApiError(422, 'invalid', 'invalid', {})), false);
});
