import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AssistantDecisionValidationError,
  buildAssistantDecisionFeed,
  approvalDecisionVersion,
  executeAssistantDecisionCommand,
  starterDecisionCards,
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

test('decision commands delegate only to the selected persisted-domain action', async () => {
  const calls: string[] = [];
  const handlers = {
    async approveAndStart(card: { subject: { id: string } }) { calls.push(`plan:${card.subject.id}`); },
    async decideApproval(card: { subject: { id: string } }, decision: string, note: string) {
      calls.push(`approval:${card.subject.id}:${decision}:${note}`);
    },
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
  assert.equal(await executeAssistantDecisionCommand({
    card: approvalCard, actionId: 'take_over', expectedVersion: approvalCard.subject.version, handlers,
  }), 'completed');

  const starterCard = starterDecisionCards([{
    id: 'quote:quote-1', type: 'quotation', title: '报价待审批', summary: '请确认报价', riskLevel: 'L2',
    effect: '不会自动发送给客户', subjectVersion: 'hash-v1', dueAt: null,
    actions: [{ command: 'resolve_decision', disabledReason: '' }],
  }], now.toISOString())[0]!;
  assert.equal(await executeAssistantDecisionCommand({
    card: starterCard, actionId: 'approve', expectedVersion: starterCard.subject.version, handlers,
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
    'handoff:approval-publish',
    'starter:quote:quote-1:approved:',
  ]);
});
