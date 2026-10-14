import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AssistantDecisionValidationError,
  buildAssistantDecisionFeed,
  approvalDecisionVersion,
  executeAssistantDecisionCommand,
  starterDecisionCards,
  taskWithAssistantProductionInput,
  validateAssistantDecisionCommand,
} from './assistantDecisionCenter.js';
import type {
  ApprovalRecord,
  GoalRecord,
  PlanRecord,
  RunRecord,
  TaskRecord,
} from '../routes/digitalEmployeeRecords.js';

const now = new Date('2026-10-10T02:00:00.000Z');

const goal = {
  id: 'goal-1', tenant_id: 'tenant-1', title: '本周增长', objective: '获得有效询盘', metric: 'leads',
  baseline: 0, target: 5, unit: '条', starts_at: '2026-10-05', ends_at: '2026-10-11', scope: {}, constraints: [],
  owner_id: 'owner-1', status: 'draft', version: 3, created_at: now.toISOString(), updated_at: now.toISOString(),
} as GoalRecord;

const plan = {
  id: 'plan-1', tenant_id: 'tenant-1', goal_id: goal.id, status: 'draft', created_at: now.toISOString(),
  plan: {
    businessPackage: {
      revision: 1, tasks: [], authorization: { mode: 'each', accountIds: [], maxPublishItems: 0, customerIds: [], maxCustomerMessages: 0 },
      maturity: 'growing', participation: 'agent',
      operatingContext: {
        objective: goal.objective, metric: goal.metric, markets: ['US'], cycle: { startsAt: goal.starts_at, endsAt: goal.ends_at },
        accounts: [], budget: { currency: 'CNY', productionCny: 50, paidMediaCny: 0, totalCny: 50 },
        cadence: { contentCount: 2, description: '', reviewSchedule: '' },
        authorization: { mode: 'each', allowRealPublishing: false, allowRealCustomerMessages: false, accountIds: [], maxPublishItems: 0, maxCustomerMessages: 0 },
        outputs: { count: 2, formats: ['mp4'], totalDurationSeconds: 60 },
      },
    },
  },
} as PlanRecord;

const run = {
  id: 'run-1', tenant_id: 'tenant-1', goal_id: goal.id, plan_id: plan.id, status: 'waiting_approval',
  current_controller: 'human', pause_reason: '', started_at: now.toISOString(), completed_at: '',
} as RunRecord;

function task(id: string, key: string, status: TaskRecord['status'], effect: TaskRecord['external_effect'] = 'none'): TaskRecord {
  return {
    id, tenant_id: 'tenant-1', goal_id: goal.id, plan_id: plan.id, run_id: run.id, task_key: key,
    title: `${key} task`, description: '', agent_role: 'business', kind: 'approval', status, sequence: 1,
    priority: 'high', requires_approval: true, depends_on: [], output: { providerLog: 'must-not-leak' },
    blocked_reason: status === 'failed' ? '缺少用户确认' : '', owner_id: '', created_at: now.toISOString(), updated_at: now.toISOString(),
    external_effect: effect, business_refs: [], task_version: 4,
  };
}

function approval(id: string, taskId: string, summary: string): ApprovalRecord {
  return {
    id, tenant_id: 'tenant-1', goal_id: goal.id, run_id: run.id, task_id: taskId, status: 'pending',
    action_summary: summary, risk_level: 'L2', evidence: [{ type: 'private_event_log', raw: 'must-not-leak' }],
    requested_by_agent: 'business', decided_by: '', decision_note: '', created_at: now.toISOString(), decided_at: '',
    subject_version: 4, content_hash: 'hash-1',
  };
}

test('decision feed keeps plan confirmation first and excludes execution details', () => {
  const publish = task('task-publish', 'content_release_approval', 'waiting_approval', 'publish');
  const content = task('task-content', 'content_quality_review', 'waiting_approval');
  const blocked = task('task-blocked', 'content_production', 'failed');
  const feed = buildAssistantDecisionFeed({
    page: 'smartAssets', goal, plan, run,
    tasks: [publish, content, blocked],
    approvals: [approval('approval-publish', publish.id, '确认真实发布'), approval('approval-content', content.id, '确认内容质量')],
    now,
  });
  assert.deepEqual(feed.items.map(item => item.kind), ['plan_adjustment', 'external_approval', 'content_approval']);
  assert.equal(feed.total, 4);
  assert.equal(feed.items[0]?.actions[0]?.id, 'approve_and_start');
  const serialized = JSON.stringify(feed);
  assert.doesNotMatch(serialized, /must-not-leak|providerLog|private_event_log|events|RunEvent/);
});

test('decision command accepts current legal action and rejects stale, illegal and incomplete actions', () => {
  const publish = task('task-publish', 'content_release_approval', 'waiting_approval', 'publish');
  const card = buildAssistantDecisionFeed({
    page: 'smartAssets', goal: { ...goal, status: 'active' }, plan: { ...plan, status: 'approved' }, run,
    tasks: [publish], approvals: [approval('approval-publish', publish.id, '确认真实发布')], now,
  }).items[0]!;
  assert.equal(validateAssistantDecisionCommand(card, 'approve', card.subject.version).id, 'approve');
  assert.throws(
    () => validateAssistantDecisionCommand(card, 'approve', 'stale-version'),
    (error: unknown) => error instanceof AssistantDecisionValidationError && error.code === 'assistant_decision_changed' && error.status === 409,
  );
  assert.throws(
    () => validateAssistantDecisionCommand(card, 'approve_and_start', card.subject.version),
    (error: unknown) => error instanceof AssistantDecisionValidationError && error.code === 'assistant_decision_action_not_allowed',
  );
  assert.throws(
    () => validateAssistantDecisionCommand(card, 'reject', card.subject.version),
    (error: unknown) => error instanceof AssistantDecisionValidationError && error.code === 'assistant_decision_note_required',
  );
});

test('a missing enterprise presenter becomes an actionable assistant card while preserving handoff', () => {
  const blocked = {
    ...task('task-avatar', 'content_production', 'failed'),
    blocked_reason: '第 1 镜尚未录入可用企业数字人，其他镜头已保留',
    output: { waitState: { kind: 'input', code: 'avatar_required', requiresAttention: true } },
  } as TaskRecord;
  const card = buildAssistantDecisionFeed({
    page: 'digitalEmployees', goal: null, plan: null, run: { ...run, status: 'paused' },
    tasks: [blocked], approvals: [], now,
  }).items[0]!;
  assert.equal(card.title, '请添加企业数字人形象');
  assert.equal(card.actions[0]?.id, 'open_workspace');
  assert.equal(card.actions[0]?.label, '添加数字人形象');
  assert.ok(card.actions.every(action => action.id !== 'take_over'));
  assert.equal(card.deepLink?.page, 'digitalEmployees');
  assert.equal(card.deepLink?.businessRef?.taskKey, 'presenter_setup_required');
  assert.doesNotMatch(JSON.stringify(card), /providerLog/);
});

test('a linked production project can surface the avatar requirement without leaking its full spec', () => {
  const waiting = {
    ...task('task-avatar-project', 'content_production', 'waiting_external'),
    blocked_reason: '当前分镜未进入智能生成预算计划，未调用供应商',
    business_refs: [{ type: 'studio_project', id: 'project-avatar' }],
    output: { businessRefs: [{ type: 'studio_project', id: 'project-avatar' }] },
  } as TaskRecord;
  const enriched = taskWithAssistantProductionInput(waiting, [{
    id: 'project-avatar',
    spec: {
      providerLog: 'must-not-leak',
      automatedReplicationShots: [
        { shotId: 'one', kind: 'blocked', intendedKind: 'person', blockerCode: 'presenter_authorization_required' },
      ],
    },
  }]);
  const card = buildAssistantDecisionFeed({
    page: 'digitalEmployees', goal: null, plan: null, run: { ...run, status: 'paused' },
    tasks: [enriched], approvals: [], now,
  }).items[0]!;
  assert.equal(card.title, '请添加企业数字人形象');
  assert.equal(card.actions[0]?.label, '添加数字人形象');
  assert.doesNotMatch(JSON.stringify(enriched), /must-not-leak|providerLog|automatedReplicationShots/);
  assert.deepEqual((enriched.output as any).assistantInput, {
    code: 'avatar_required',
    message: '人物镜头缺少可用且已授权的企业数字人形象',
    presenterId: '',
    presenterName: '',
    presenterCount: 0,
    projectCount: 1,
  });
});

test('an added presenter is no longer described as missing when replication setup is incomplete', () => {
  const waiting = {
    ...task('task-avatar-setup', 'content_production', 'waiting_external'),
    blocked_reason: '第 1 镜尚未录入可用企业数字人',
    business_refs: [{ type: 'studio_project', id: 'project-avatar-setup' }],
  } as TaskRecord;
  const enriched = taskWithAssistantProductionInput(waiting, [{
    id: 'project-avatar-setup',
    spec: { automatedReplicationShots: [
      { shotId: 'one', kind: 'blocked', intendedKind: 'person', blockerCode: 'presenter_authorization_required' },
    ] },
  }], { state: 'production_setup_required', presenterCount: 1, presenterId: 'presenter-dante', presenterName: 'Dante Office 2' });
  const card = buildAssistantDecisionFeed({
    page: 'digitalEmployees', goal: null, plan: null, run: { ...run, status: 'paused' },
    tasks: [enriched], approvals: [], now,
  }).items[0]!;
  assert.equal(card.title, '请补齐数字人的制作条件');
  assert.equal(card.actions[0]?.label, '补齐制作条件');
  assert.match(card.summary, /已添加.*人物参考图.*方舟/);
  assert.equal(card.deepLink?.page, 'digitalEmployees');
  assert.equal(card.deepLink?.businessRef?.taskKey, 'presenter_setup_required');
  assert.equal(card.deepLink?.businessRef?.entityId, 'presenter-dante');
});

test('a newly ready presenter replaces the stale add-person prompt with continuation', () => {
  const waiting = {
    ...task('task-avatar-ready', 'content_production', 'waiting_external'),
    blocked_reason: '第 1 镜尚未录入可用企业数字人',
    business_refs: [{ type: 'studio_project', id: 'project-avatar-ready' }],
  } as TaskRecord;
  const enriched = taskWithAssistantProductionInput(waiting, [{
    id: 'project-avatar-ready',
    spec: { automatedReplicationShots: [
      { shotId: 'one', kind: 'blocked', intendedKind: 'person', blockerCode: 'presenter_authorization_required' },
    ] },
  }], { state: 'ready', presenterCount: 1, presenterId: 'presenter-ready', presenterName: '企业主讲人' });
  const card = buildAssistantDecisionFeed({
    page: 'digitalEmployees', goal: null, plan: null, run: { ...run, status: 'paused' },
    tasks: [enriched], approvals: [], now,
  }).items[0]!;
  assert.equal(card.kind, 'next_step');
  assert.equal(card.title, '数字人已就绪，请继续生产');
  assert.equal(card.actions[0]?.label, '查看并继续生产');
  assert.match(card.summary, /企业主讲人 已就绪/);
  assert.notEqual(card.deepLink?.page, 'enterprise');
});

test('starter decisions remain available through the unified queue without exposing workspace telemetry', () => {
  const cards = starterDecisionCards([{
    id: 'quote:quote-1', type: 'quotation', title: '报价待审批', summary: '请确认报价', riskLevel: 'L2',
    effect: '不会自动发送给客户', subjectVersion: 'hash-v1', dueAt: null,
    actions: [{ command: 'resolve_decision', disabledReason: '' }],
  }], now.toISOString());
  assert.equal(cards[0]?.kind, 'external_approval');
  assert.equal(cards[0]?.subject.version, 'hash-v1');
  assert.deepEqual(cards[0]?.actions.map(action => action.id), ['approve', 'reject', 'open_workspace']);
});

test('approval decision versions freeze evidence as well as subject and content', () => {
  const original = approval('approval-publish', 'task-publish', '确认真实发布');
  const changed = { ...original, evidence: [{ type: 'publishing_approval_package', items: [{ platform: 'tiktok', accountIds: ['account-1', 'account-2'] }] }] };
  assert.notEqual(approvalDecisionVersion(original), approvalDecisionVersion(changed), 'changed recipient or request evidence must invalidate a displayed decision');
  const publish = task('task-publish', 'content_release_approval', 'waiting_approval', 'publish');
  const card = buildAssistantDecisionFeed({ page: 'smartAssets', goal: null, plan: null, run, tasks: [publish], approvals: [changed], now }).items[0]!;
  assert.equal(card.facts.find(fact => fact.label === '账号')?.value, '2 个账号');
  assert.throws(() => validateAssistantDecisionCommand(card, 'approve', approvalDecisionVersion(original)), (error: unknown) => error instanceof AssistantDecisionValidationError && error.status === 409);
});

test('failed source collection explains the viral-library gap and offers direct recovery', () => {
  const collection = {
    ...task('task-collection', 'scheduled_source_collection', 'failed'),
    blocked_reason: '平台采集任务返回服务错误',
    output: {
      inventorySummary: '爆款库可直接使用 1/2 条，还缺 1 条；只采集并分析缺口。',
      inventoryPreflight: { requiredCount: 2, reusableCount: 1, missingCount: 1 },
    },
  } as TaskRecord;
  const card = buildAssistantDecisionFeed({
    page: 'digitalEmployees', goal: null, plan: null, run: { ...run, status: 'waiting_human' },
    tasks: [collection], approvals: [], now,
  }).items[0]!;
  assert.match(card.summary, /可直接使用 1\/2 条.*缺 1 条/);
  assert.match(card.summary, /平台采集任务返回服务错误/);
  assert.equal(card.facts.find(fact => fact.label === '爆款库存')?.value, '可用 1/2 条，缺 1 条');
  assert.deepEqual(card.actions.slice(0, 2).map(action => action.id), ['retry_task', 'replan_task']);
  assert.equal(card.actions[0]?.label, '从当前节点重试');
});

test('a failed production node remains retryable without exposing human takeover', () => {
  const failed = task('task-routing', 'content_mode_routing', 'failed');
  const card = buildAssistantDecisionFeed({
    page: 'digitalEmployees', goal: null, plan: null, run: { ...run, status: 'waiting_human' },
    tasks: [failed], approvals: [], now,
  }).items[0]!;
  assert.equal(card.actions[0]?.id, 'retry_task');
  assert.equal(card.actions[0]?.label, '重试当前节点');
  assert.ok(card.actions.every(action => action.id !== 'take_over'));
});

test('a production node waiting on a recovered service can retry in place', () => {
  const waiting = {
    ...task('task-production', 'content_production', 'waiting_external'),
    blocked_reason: '爆款复刻需要当前分镜可读取的原片首帧',
  } as TaskRecord;
  const card = buildAssistantDecisionFeed({
    page: 'digitalEmployees', goal: null, plan: null, run: { ...run, status: 'waiting_human' },
    tasks: [waiting], approvals: [], now,
  }).items[0]!;
  assert.equal(card.actions[0]?.id, 'retry_task');
  assert.equal(card.actions[0]?.label, '重试当前节点');
  assert.equal(card.actions[1]?.id, 'open_workspace');
  assert.ok(card.actions.every(action => action.id !== 'take_over'));
});

test('a user-input blocker is not mislabeled as an external wait or offered a pointless retry', () => {
  const waiting = {
    ...task('task-release', 'content_release_approval', 'waiting_human'),
    blocked_reason: '审批前资源预检未通过：尚未连接发布账号',
    output: { waitState: { kind: 'input', message: '尚未连接发布账号', requiresAttention: true } },
  } as TaskRecord;
  const card = buildAssistantDecisionFeed({
    page: 'digitalEmployees', goal: null, plan: null, run: { ...run, status: 'waiting_human' },
    tasks: [waiting], approvals: [], now,
  }).items[0]!;
  assert.equal(card.facts[0]?.value, '等待用户');
  assert.deepEqual(card.actions.map(action => action.id), ['open_workspace']);
  assert.equal(card.actions[0]?.label, '前往处理');
});

test('a production node still processing is not presented as a user decision', () => {
  const processing = {
    ...task('task-production-processing', 'content_production', 'waiting_external'),
    blocked_reason: '内容任务正在推进，等待制作或质检结果回写。',
    output: {
      waitState: {
        kind: 'processing',
        message: '内容任务正在推进，等待制作或质检结果回写。',
        requiresAttention: false,
      },
    },
  } as TaskRecord;
  const feed = buildAssistantDecisionFeed({
    page: 'smartAssets', goal: null, plan: null, run, tasks: [processing], approvals: [], now,
  });
  assert.equal(feed.total, 0);
  assert.deepEqual(feed.items, []);
});

test('viral analysis remains visibly blocked until exact evidence is complete', () => {
  const analysis = {
    ...task('task-analysis', 'viral_analysis', 'waiting_external'),
    blocked_reason: '本周 2 条视频需要 2 条独立精确分析，当前仅完成 1 条，还缺 1 条',
    output: { proof: { value: 1, requiredValue: 2, status: 'pending' } },
  } as TaskRecord;
  const card = buildAssistantDecisionFeed({
    page: 'digitalEmployees', goal: null, plan: null, run, tasks: [analysis], approvals: [], now,
  }).items[0]!;
  assert.match(card.summary, /当前仅完成 1 条.*还缺 1 条/);
  assert.match(card.summary, /不会把“已排队”当作“已完成”/);
  assert.equal(card.facts.find(fact => fact.label === '当前状态')?.value, '分析未完成');
  assert.equal(card.facts.find(fact => fact.label === '分析进度')?.value, '1/2 条通过');
  assert.equal(card.actions[0]?.label, '查看分析进度');
});

test('queued workflow work never claims that evidence is ready to continue', () => {
  const queued = task('task-queued', 'scheduled_source_collection', 'pending');
  queued.depends_on = [];
  const card = buildAssistantDecisionFeed({
    page: 'digitalEmployees', goal: null, plan: null, run, tasks: [queued], approvals: [], now,
  }).items[0]!;
  assert.equal(card.facts[0]?.value, '已排队');
  assert.doesNotMatch(card.summary, /可以继续/);
  assert.equal(card.actions[0]?.label, '查看真实进度');

  const blocked = { ...task('task-blocked', 'viral_analysis', 'pending'), depends_on: ['scheduled_source_collection'] } as TaskRecord;
  assert.equal(buildAssistantDecisionFeed({
    page: 'digitalEmployees', goal: null, plan: null, run, tasks: [blocked], approvals: [], now,
  }).items.length, 0, 'a dependency-blocked task must not be advertised as the next actionable step');
});

test('decision commands delegate only to the selected persisted-domain action', async () => {
  const calls: string[] = [];
  const handlers = {
    async approveAndStart(card: { subject: { id: string } }) { calls.push(`plan:${card.subject.id}`); },
    async decideApproval(card: { subject: { id: string } }, decision: string, note: string) {
      calls.push(`approval:${card.subject.id}:${decision}:${note}`);
    },
    async retryTask(card: { subject: { id: string } }) { calls.push(`retry:${card.subject.id}`); },
    async replanTask(card: { subject: { id: string } }) { calls.push(`replan:${card.subject.id}`); },
    async takeOver(card: { subject: { id: string } }) { calls.push(`handoff:${card.subject.id}`); },
    async decideStarter(card: { subject: { id: string } }, decision: string, note: string) {
      calls.push(`starter:${card.subject.id}:${decision}:${note}`);
    },
  };

  const planCard = buildAssistantDecisionFeed({
    page: 'digitalEmployees', goal, plan, run: null, tasks: [], approvals: [], now,
  }).items[0]!;
  assert.equal(await executeAssistantDecisionCommand({
    card: planCard, actionId: 'approve_and_start', expectedVersion: planCard.subject.version, handlers,
  }), 'completed');

  const publish = task('task-publish', 'content_release_approval', 'waiting_approval', 'publish');
  const approvalCard = buildAssistantDecisionFeed({
    page: 'smartAssets', goal: { ...goal, status: 'active' }, plan: { ...plan, status: 'approved' }, run,
    tasks: [publish], approvals: [approval('approval-publish', publish.id, '确认真实发布')], now,
  }).items[0]!;
  assert.equal(await executeAssistantDecisionCommand({
    card: approvalCard, actionId: 'reject', expectedVersion: approvalCard.subject.version,
    note: '  请补充证据  ', handlers,
  }), 'completed');
  assert.ok(approvalCard.actions.every(action => action.id !== 'take_over'), 'Lingxiaoshu never exposes a human-takeover button');

  const starterCard = starterDecisionCards([{
    id: 'quote:quote-1', type: 'quotation', title: '报价待审批', summary: '请确认报价', riskLevel: 'L2',
    effect: '不会自动发送给客户', subjectVersion: 'hash-v1', dueAt: null,
    actions: [{ command: 'resolve_decision', disabledReason: '' }],
  }], now.toISOString())[0]!;
  assert.equal(await executeAssistantDecisionCommand({
    card: starterCard, actionId: 'approve', expectedVersion: starterCard.subject.version, handlers,
  }), 'completed');

  const collection = {
    ...task('task-collection', 'scheduled_source_collection', 'failed'),
    output: { inventoryPreflight: { requiredCount: 2, reusableCount: 1, missingCount: 1 } },
  } as TaskRecord;
  const collectionCard = buildAssistantDecisionFeed({
    page: 'digitalEmployees', goal: null, plan: null, run: { ...run, status: 'waiting_human' },
    tasks: [collection], approvals: [], now,
  }).items[0]!;
  assert.equal(await executeAssistantDecisionCommand({
    card: collectionCard, actionId: 'retry_task', expectedVersion: collectionCard.subject.version, handlers,
  }), 'completed');
  assert.equal(await executeAssistantDecisionCommand({
    card: collectionCard, actionId: 'replan_task', expectedVersion: collectionCard.subject.version, handlers,
  }), 'completed');

  const beforeNavigation = calls.length;
  assert.equal(await executeAssistantDecisionCommand({
    card: planCard, actionId: 'adjust_plan', expectedVersion: planCard.subject.version, handlers,
  }), 'navigation_required');
  assert.equal(calls.length, beforeNavigation, 'navigation must not mutate domain state');

  await assert.rejects(
    executeAssistantDecisionCommand({
      card: approvalCard, actionId: 'approve', expectedVersion: 'stale', handlers,
    }),
    (error: unknown) => error instanceof AssistantDecisionValidationError
      && error.code === 'assistant_decision_changed' && error.status === 409,
  );
  assert.deepEqual(calls, [
    `plan:${goal.id}`,
    'approval:approval-publish:rejected:请补充证据',
    'starter:quote:quote-1:approved:',
    'retry:task-collection',
    'replan:task-collection',
  ]);
});
