import assert from 'node:assert/strict';
import test from 'node:test';
import { DigitalEmployeeApiError } from '../lib/digitalEmployeeApi';
import { digitalEmployeeApi, type DigitalEmployeeOverview } from '../lib/digitalEmployees';
import { createDigitalEmployeeWeeklyLaunch } from './digitalEmployeeWeeklyLaunch';

const draft = {
  goal: { id: 'goal-a', version: 1 },
  plan: { businessPackage: {
    revision: 3,
    tasks: [{ templateId: 'production', videoPlans: [{ contentId: 'content-a', productionRole: 'master' }] }],
  } },
  run: null,
  tasks: [],
} as unknown as DigitalEmployeeOverview;
const prepared = {
  ...draft,
  plan: { businessPackage: {
    ...draft.plan!.businessPackage!,
    revision: 3,
    detailGeneration: {
      status: 'ready', startedAt: '2026-10-23T07:55:00Z', generatedAt: '2026-10-23T07:56:00Z',
      estimatedMinutes: 2, usageCostCny: null, readyCount: 1, blockedCount: 0, blockers: [],
    },
  } },
} as unknown as DigitalEmployeeOverview;
const running = {
  ...prepared,
  run: { id: 'run-a', goal_id: 'goal-a', status: 'running', started_at: '2026-10-23T08:00:00Z' },
  tasks: [{ id: 'task-a', run_id: 'run-a', status: 'running', sequence: 1, title: '内容生产' }],
} as DigitalEmployeeOverview;

function setup(options: {
  data?: DigitalEmployeeOverview | null;
  generatePackageDetails?: () => Promise<DigitalEmployeeOverview>;
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
    generatePackageDetails: async () => { calls.push('prepare'); return options.generatePackageDetails ? options.generatePackageDetails() : prepared; },
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
  assert.deepEqual(run.calls.filter(value => ['prepare', 'approve'].includes(value)), ['prepare', 'approve']);
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

test('a newly persisted draft can use the same version-bound launch path without relying on stale page data', async () => {
  const run = setup({ data: null });
  await run.launchWeeklyPlan(draft);
  assert.deepEqual(run.calls.filter(value => ['prepare', 'approve'].includes(value)), ['prepare', 'approve']);
  assert.equal(run.calls.filter(value => value === 'approve').length, 1);
  assert.deepEqual(run.data, [running]);
});

test('a blocked preparation remains visible and never requests a real run', async () => {
  const blocked = {
    ...prepared,
    plan: { businessPackage: {
      ...prepared.plan!.businessPackage!,
      detailGeneration: {
        ...prepared.plan!.businessPackage!.detailGeneration!,
        status: 'blocked', readyCount: 0, blockedCount: 1, blockers: ['缺少产品素材'],
      },
    } },
  } as unknown as DigitalEmployeeOverview;
  const run = setup({ generatePackageDetails: async () => blocked });
  await run.confirmWeeklyPlan();
  assert.deepEqual(run.calls.filter(value => ['prepare', 'approve'].includes(value)), ['prepare']);
  assert.deepEqual(run.data, [blocked]);
  assert.match(run.errors.at(-1) || '', /缺少产品素材/);
  assert.deepEqual(run.feedback.at(-1), { title: '周任务未启动', tone: 'error' });
});

test('a preparation receipt for another goal is rejected without replacing visible state', async () => {
  const mismatched = { ...prepared, goal: { ...prepared.goal!, id: 'goal-other' } } as DigitalEmployeeOverview;
  const run = setup({ generatePackageDetails: async () => mismatched });
  await run.confirmWeeklyPlan();
  assert.deepEqual(run.calls.filter(value => ['prepare', 'approve'].includes(value)), ['prepare']);
  assert.deepEqual(run.data, []);
  assert.match(run.errors.at(-1) || '', /当前周目标不一致/);
});

test('an uncertain preparation continues only after a read-only receipt proves it is ready', async () => {
  const run = setup({
    generatePackageDetails: async () => { throw new Error('connection closed'); },
    overview: async () => prepared,
  });
  await run.confirmWeeklyPlan();
  assert.deepEqual(run.calls.filter(value => ['prepare', 'overview', 'approve'].includes(value)), ['prepare', 'overview', 'approve']);
  assert.deepEqual(run.data, [running]);
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
