import assert from 'node:assert/strict';
import test from 'node:test';
import { DigitalEmployeeApiError } from '../lib/digitalEmployeeApi';
import { digitalEmployeeApi, type DigitalEmployeeOverview } from '../lib/digitalEmployees';
import { createDigitalEmployeeWeeklyLaunch } from './digitalEmployeeWeeklyLaunch';

const draft = {
  goal: { id: 'goal-a', version: 1 },
  plan: { businessPackage: { revision: 3 } },
  run: null,
  tasks: [],
} as unknown as DigitalEmployeeOverview;
const running = {
  ...draft,
  run: { id: 'run-a', goal_id: 'goal-a', status: 'running', started_at: '2026-10-23T08:00:00Z' },
  tasks: [{ id: 'task-a', run_id: 'run-a', status: 'running', sequence: 1, title: '内容生产' }],
} as DigitalEmployeeOverview;

function setup(options: {
  data?: DigitalEmployeeOverview | null;
  approveGoal?: () => Promise<DigitalEmployeeOverview>;
  overview?: () => Promise<DigitalEmployeeOverview>;
  recover?: () => Promise<boolean>;
} = {}) {
  const calls: string[] = [];
  const errors: string[] = [];
  const views: string[] = [];
  const feedback: Array<{ title: string; tone?: string }> = [];
  const events: unknown[] = [];
  const conflicts: unknown[] = [];
  const data: DigitalEmployeeOverview[] = [];
  const version = { current: 0 };
  const api = {
    approveGoal: async () => { calls.push('approve'); return options.approveGoal ? options.approveGoal() : running; },
    overview: async () => { calls.push('overview'); return options.overview ? options.overview() : running; },
  } as unknown as typeof digitalEmployeeApi;
  const action = createDigitalEmployeeWeeklyLaunch({
    data: options.data === undefined ? draft : options.data,
    busy: '',
    overviewRequestVersionRef: version,
    setData: value => data.push(value),
    setBusy: value => calls.push(`busy:${value}`),
    setError: value => errors.push(value),
    setWeeklyStartConflict: value => conflicts.push(value),
    setWeeklyPlanOpen: () => undefined,
    setNewGoal: () => undefined,
    setWorkspaceView: value => views.push(value),
    setSelectedTaskId: () => undefined,
    recoverEnterpriseFactsChanged: async () => options.recover ? options.recover() : false,
    api,
    feedback: value => feedback.push({ title: value.title, tone: value.tone }),
    notify: value => events.push(value),
  });
  return { ...action, calls, errors, views, feedback, events, conflicts, data, version };
}

test('one confirmation accepts only a persisted matching run and publishes its scoped receipt', async () => {
  const run = setup();
  await run.confirmWeeklyPlan();
  assert.equal(run.calls.filter(value => value === 'approve').length, 1);
  assert.equal(run.calls.includes('overview'), false);
  assert.deepEqual(run.data, [running]);
  assert.deepEqual(run.views, ['matrix']);
  assert.equal(run.version.current, 1);
  assert.deepEqual(run.events, [{
    source: 'page', goalId: 'goal-a',
    execution: { goalId: 'goal-a', runId: 'run-a', status: 'running', taskCount: 1, startedAt: '2026-10-23T08:00:00Z' },
  }]);
});

test('an uncertain launch response performs one read-only reconciliation and never approves twice', async () => {
  const run = setup({ approveGoal: async () => { throw new Error('connection closed'); } });
  await run.confirmWeeklyPlan();
  assert.deepEqual(run.calls.filter(value => ['approve', 'overview'].includes(value)), ['approve', 'overview']);
  assert.deepEqual(run.data, [running]);
});

test('an uncertain response without a persisted receipt remains visibly unresolved', async () => {
  const run = setup({
    approveGoal: async () => { throw new Error('connection closed'); },
    overview: async () => draft,
  });
  await run.confirmWeeklyPlan();
  assert.deepEqual(run.calls.filter(value => ['approve', 'overview'].includes(value)), ['approve', 'overview']);
  assert.equal(run.data.length, 0);
  assert.match(run.errors.at(-1) || '', /不会自动重复启动/);
  assert.deepEqual(run.feedback.at(-1), { title: '启动结果待确认', tone: 'warning' });
});

test('an existing-run conflict stays visible and does not trigger reconciliation', async () => {
  const run = setup({ approveGoal: async () => { throw new DigitalEmployeeApiError(409, 'active_goal_exists', 'conflict', {
    activeGoalId: 'goal-other', activeRunId: 'run-other', activeGoalTitle: '另一轮',
  }); } });
  await run.confirmWeeklyPlan();
  assert.deepEqual(run.calls.filter(value => ['approve', 'overview'].includes(value)), ['approve']);
  assert.equal((run.conflicts.at(-1) as { goalId: string }).goalId, 'goal-other');
  assert.deepEqual(run.feedback.at(-1), { title: '周任务未启动', tone: 'error' });
});

test('a handled facts conflict does not replay or reconcile the stale launch', async () => {
  const run = setup({
    approveGoal: async () => { throw new Error('facts changed'); },
    recover: async () => true,
  });
  await run.confirmWeeklyPlan();
  assert.deepEqual(run.calls.filter(value => ['approve', 'overview'].includes(value)), ['approve']);
  assert.equal(run.data.length, 0);
});
