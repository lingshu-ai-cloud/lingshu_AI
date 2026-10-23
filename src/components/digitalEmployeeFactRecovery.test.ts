import assert from 'node:assert/strict';
import test from 'node:test';
import { DigitalEmployeeApiError } from '../lib/digitalEmployeeApi';
import {
  ENTERPRISE_FACTS_CHANGED_ERROR_CODE,
  type DigitalEmployeeOverview,
} from '../lib/digitalEmployees';
import { createDigitalEmployeeFactRecovery } from './digitalEmployeeFactRecovery';

const goal = { id: 'goal/a', version: 4 };
const details = {
  expectedGoalVersion: 4,
  sourcePlanId: 'source-plan-a',
  expectedFactsVersion: 'facts-v3',
  expectedSourcePlanDigest: 'a'.repeat(64),
};
const changedFacts = () => new DigitalEmployeeApiError(409, ENTERPRISE_FACTS_CHANGED_ERROR_CODE, 'facts changed', details);
const rebuilt = { goal: { id: 'replacement-goal' } } as DigitalEmployeeOverview;

function setup(rebuildGoal: NonNullable<Parameters<typeof createDigitalEmployeeFactRecovery>[0]['rebuildGoal']>) {
  const pending = new Map<string, Promise<void>>();
  const version = { current: 0 };
  const data: DigitalEmployeeOverview[] = [];
  const errors: string[] = [];
  const notices: string[] = [];
  let authorization = 'tenant-a';
  const recover = createDigitalEmployeeFactRecovery({
    pending,
    overviewRequestVersionRef: version,
    setData: value => data.push(value),
    setError: value => errors.push(value),
    setViewGoalId: () => undefined,
    setNewGoal: () => undefined,
    setPlanHistoryOpen: () => undefined,
    setSelectedContentItemId: () => undefined,
    setWorkspaceView: () => undefined,
    setWeeklyPlanOpen: () => undefined,
    authorization: () => authorization,
    rebuildGoal,
    notifySuccess: title => notices.push(title),
  });
  return { recover, pending, version, data, errors, notices, changeAuthorization: (next: string) => { authorization = next; } };
}

test('only a structured conflict with complete source-plan evidence can rebuild', async () => {
  let calls = 0;
  const run = setup(async () => { calls += 1; return rebuilt; });
  assert.equal(await run.recover(new Error('facts changed'), goal), false);
  assert.equal(await run.recover(new DigitalEmployeeApiError(409, ENTERPRISE_FACTS_CHANGED_ERROR_CODE, 'missing', {}), goal), false);
  assert.equal(await run.recover(changedFacts(), null), false);
  assert.equal(calls, 0);
  assert.equal(run.version.current, 0);
});

test('matching concurrent conflicts share one guarded rebuild and update the current overview', async () => {
  let calls = 0;
  let release: ((value: DigitalEmployeeOverview) => void) | undefined;
  const run = setup(async () => {
    calls += 1;
    return new Promise<DigitalEmployeeOverview>(resolve => { release = resolve; });
  });
  const first = run.recover(changedFacts(), goal);
  const duplicate = run.recover(changedFacts(), goal);
  assert.equal(calls, 1);
  release?.(rebuilt);
  assert.deepEqual(await Promise.all([first, duplicate]), [true, true]);
  assert.deepEqual(run.data, [rebuilt]);
  assert.equal(run.version.current, 1);
  assert.equal(run.pending.size, 0);
  assert.deepEqual(run.notices, ['计划已按最新企业资料重建']);
});

test('a second facts conflict retries the guarded rebuild once, without replaying the original action', async () => {
  let calls = 0;
  const run = setup(async () => {
    calls += 1;
    if (calls === 1) throw changedFacts();
    return rebuilt;
  });
  assert.equal(await run.recover(changedFacts(), goal), true);
  assert.equal(calls, 2);
  assert.deepEqual(run.data, [rebuilt]);
});

test('an authorization change fences out a completed rebuild from the old tenant', async () => {
  let release: ((value: DigitalEmployeeOverview) => void) | undefined;
  const run = setup(async () => new Promise<DigitalEmployeeOverview>(resolve => { release = resolve; }));
  const recovery = run.recover(changedFacts(), goal);
  run.changeAuthorization('tenant-b');
  release?.(rebuilt);
  assert.equal(await recovery, true);
  assert.deepEqual(run.data, []);
  assert.deepEqual(run.notices, []);
  assert.equal(run.version.current, 0);
  assert.equal(run.pending.size, 0);
});
