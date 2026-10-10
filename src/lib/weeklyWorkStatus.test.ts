import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DigitalEmployeeOverview, WorkflowTask } from './digitalEmployees';
import { weeklyWorkStatus } from './weeklyWorkStatus';

const task = (status: string, patch: Partial<WorkflowTask> = {}): WorkflowTask => ({
  id: `task-${status}`,
  run_id: 'run-1',
  task_key: status,
  title: `任务 ${status}`,
  description: '',
  agent_role: 'content',
  kind: 'workflow',
  status,
  sequence: 1,
  priority: 'normal',
  requires_approval: false,
  depends_on: [],
  output: {},
  blocked_reason: '',
  owner_id: '',
  updated_at: '2026-10-11T01:00:00.000Z',
  ...patch,
});

const overview = (patch: Partial<DigitalEmployeeOverview> = {}): DigitalEmployeeOverview => ({
  config: null,
  goals: [],
  goal: { id: 'goal-1' } as DigitalEmployeeOverview['goal'],
  plan: null,
  run: null,
  tasks: [],
  events: [],
  approvals: [],
  handoffs: [],
  review: null,
  agents: [],
  businessSnapshot: null,
  ...patch,
});

const run = (status: string) => ({
  id: 'run-1',
  goal_id: 'goal-1',
  plan_id: 'plan-1',
  status,
  current_controller: 'content',
  pause_reason: '',
  started_at: '2026-10-11T01:00:00.000Z',
  completed_at: '',
});

test('prepared plan is explicitly not reported as started production', () => {
  const status = weeklyWorkStatus(overview({
    plan: { businessPackage: { detailGeneration: { status: 'ready', readyCount: 5, blockedCount: 0 } } } as DigitalEmployeeOverview['plan'],
  }));
  assert.equal(status?.phase, 'preparing');
  assert.equal(status?.runId, '');
  assert.match(status?.title || '', /尚未开始生产/);
});

test('persisted runs map to queued, running, blocked, paused and finished states', () => {
  assert.equal(weeklyWorkStatus(overview({ run: run('planning'), tasks: [task('pending')] }))?.phase, 'queued');
  assert.equal(weeklyWorkStatus(overview({ run: run('running'), tasks: [task('running')] }))?.phase, 'running');
  const blocked = weeklyWorkStatus(overview({ run: run('running'), tasks: [task('waiting_approval', { blocked_reason: '等待确认' })] }));
  assert.equal(blocked?.phase, 'blocked');
  assert.equal(blocked?.blocker, '等待确认');
  assert.equal(weeklyWorkStatus(overview({ run: { ...run('paused'), pause_reason: '人工暂停' }, tasks: [task('pending')] }))?.phase, 'paused');
  assert.equal(weeklyWorkStatus(overview({ run: run('succeeded'), tasks: [task('succeeded')] }))?.phase, 'finished');
});

test('external waits and unknown states never masquerade as active production', () => {
  const waiting = weeklyWorkStatus(overview({ run: run('waiting_external'), tasks: [task('waiting_external', { blocked_reason: '等待平台回执' })] }));
  assert.equal(waiting?.phase, 'queued');
  assert.match(waiting?.title || '', /等待外部服务/);
  assert.doesNotMatch(waiting?.title || '', /正在生产/);

  const runningRunWaitingOnProvider = weeklyWorkStatus(overview({
    run: run('running'),
    tasks: [task('waiting_external', { blocked_reason: '等待视频供应商回写' })],
  }));
  assert.equal(runningRunWaitingOnProvider?.phase, 'queued');
  assert.match(runningRunWaitingOnProvider?.title || '', /等待外部服务/);
  assert.doesNotMatch(runningRunWaitingOnProvider?.title || '', /正在生产/);

  const unknown = weeklyWorkStatus(overview({ run: run('provider_specific_state'), tasks: [] }));
  assert.equal(unknown?.phase, 'unknown');
  assert.match(unknown?.title || '', /待确认/);
});

test('an initializing run with no scoped tasks reports initialization, not production', () => {
  const status = weeklyWorkStatus(overview({ run: run('initializing'), tasks: [] }));
  assert.equal(status?.phase, 'queued');
  assert.match(status?.title || '', /初始化/);
  assert.match(status?.description || '', /生产结果尚未确认/);
  assert.doesNotMatch(status?.title || '', /正在生产/);
});

test('a mismatched run is not presented as the current goal production', () => {
  const status = weeklyWorkStatus(overview({ run: { ...run('running'), goal_id: 'another-goal' }, tasks: [task('running')] }));
  assert.equal(status?.phase, 'unknown');
  assert.match(status?.description || '', /运行与页面周目标不一致/);
});

test('status keeps the persisted run identity and real completion count', () => {
  const status = weeklyWorkStatus(overview({
    run: run('running'),
    tasks: [task('succeeded', { id: 'done', sequence: 1 }), task('running', { id: 'current', sequence: 2, title: '生成成片' })],
  }));
  assert.equal(status?.runId, 'run-1');
  assert.equal(status?.currentTaskId, 'current');
  assert.equal(status?.completedTasks, 1);
  assert.equal(status?.totalTasks, 2);
  assert.match(status?.description || '', /1\/2/);
});

test('cancelled work is processed but not counted as completed output', () => {
  const status = weeklyWorkStatus(overview({
    run: run('cancelled'),
    tasks: [task('succeeded', { id: 'done', sequence: 1 }), task('cancelled', { id: 'cancelled', sequence: 2 })],
  }));
  assert.equal(status?.completedTasks, 1);
  assert.equal(status?.totalTasks, 2);
});
