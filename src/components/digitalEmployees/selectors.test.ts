import assert from 'node:assert/strict';
import type { ApprovalRequest, DigitalEmployeeOverview, RunEvent, WeeklyGoal, WeeklyReview, WorkItem, WorkflowTask } from '../../lib/digitalEmployees.js';
import {
  buildObjectDiff,
  canonicalWorkItemStatus,
  filterWorkItems,
  mergeRunEvents,
  parseApprovalChanges,
  selectApprovalSnapshot,
  selectBusinessOutcome,
  selectPriorityTasks,
  selectProductionEvents,
  selectManualHandoffSubmission,
  selectPublishingReconciliation,
  selectWorkflowProgress,
  selectWorkItems,
} from './selectors.js';

const task = (id: string, status: string, sequence: number): WorkflowTask => ({
  id, status, sequence, run_id: 'r', task_key: id, title: id, description: '', agent_role: 'content',
  kind: 'production', priority: 'medium', requires_approval: false, depends_on: [], output: {},
  blocked_reason: '', owner_id: '', updated_at: '',
});

assert.deepEqual(selectPriorityTasks([
  task('done', 'succeeded', 1), task('running', 'running', 3), task('failed', 'failed', 4), task('approval', 'waiting_approval', 2),
]).map(item => item.id), ['approval', 'failed', 'running', 'done']);
assert.deepEqual(selectWorkflowProgress([task('done', 'succeeded', 1), task('failed', 'failed', 2)]), { completed: 1, total: 2, failed: 1, rate: 50 });

const events: RunEvent[] = Array.from({ length: 8 }, (_, index) => ({
  id: String(index), run_id: 'r', task_id: '', sequence: index + 1,
  type: index % 2 ? 'task.completed' : 'task.started', level: index % 2 ? 'success' : 'info', summary: '', payload: {}, occurred_at: '',
}));
assert.equal(selectProductionEvents(events, 'all').length, 5);
assert.deepEqual(selectProductionEvents(events, 'all').map(event => event.sequence), [8, 7, 6, 5, 4]);
assert.ok(selectProductionEvents(events, 'completed').every(event => event.level === 'success'));
assert.deepEqual(mergeRunEvents([events[1], events[0]], [events[1], events[2]]).map(event => event.sequence), [1, 2, 3]);

assert.equal(canonicalWorkItemStatus('pending', '2025-01-01T00:00:00Z', new Date('2025-01-02T00:00:00Z')), 'expired');
assert.equal(canonicalWorkItemStatus('approved'), 'processed');
assert.equal(canonicalWorkItemStatus('active'), 'taken_over');

const overview = {
  config: null, goals: [], goal: null, contract: null, plan: null, run: null, events: [], review: null, agents: [],
  tasks: [task('failure', 'failed', 1)], handoffs: [], approvals: [],
} satisfies DigitalEmployeeOverview;
const workItems = selectWorkItems(overview);
assert.equal(workItems.length, 1);
assert.equal(workItems[0].type, 'failure');
assert.equal(filterWorkItems(workItems, { status: 'pending', type: 'failure', risk: 'high', agent: 'content', owner: '', goalId: '' }).length, 1);

const reconciliationItem: WorkItem = { id: 'publishing-reconciliation:post-1', type: 'publishing_reconciliation', status: 'pending', sourceStatus: 'needs_reconciliation', runId: 'run-1', taskId: '', ownerId: '', agent: 'publishing', risk: 'high', goalId: '', dueAt: '', postId: 'post-1', expectedRevision: 4, targetAccountIds: ['account-1', 'account-2', 'account-1'], allowedDecisions: ['confirm_published', 'confirm_not_published_retry', 'void'], blindRetryAllowed: false };
assert.deepEqual(selectPublishingReconciliation(reconciliationItem), { postId: 'post-1', expectedRevision: 4, targetAccountIds: ['account-1', 'account-2'], allowedDecisions: ['confirm_published', 'confirm_not_published_retry', 'void'], blindRetryAllowed: false, missingFields: [], canDecide: true });
assert.equal(selectPublishingReconciliation({ ...reconciliationItem, blindRetryAllowed: true })?.canDecide, false);
assert.equal(selectPublishingReconciliation({ ...reconciliationItem, allowedDecisions: [] })?.canDecide, false);

assert.deepEqual(selectManualHandoffSubmission({ note: '已处理', resultSummary: '已完成', references: [], externalActionsPerformed: true, outcome: 'completed' }), { canSubmit: false, error: 'external_action_reference_required' });
assert.deepEqual(selectManualHandoffSubmission({ note: '已处理', resultSummary: '已完成', references: ['post-42'], externalActionsPerformed: true, outcome: 'completed' }), { canSubmit: true, error: '' });
assert.equal(selectManualHandoffSubmission({ note: '已处理', resultSummary: '', references: [], externalActionsPerformed: true, outcome: 'continue' }).error, 'external_action_cannot_continue');

const approval: ApprovalRequest = {
  id: 'approval-1', goal_id: 'goal-1', run_id: 'run-1', task_id: 'task-1', status: 'pending',
  action_summary: '登记 LinkedIn 排期', risk_level: 'high', evidence: [], requested_by_agent: 'risk', owner_id: 'owner-1',
  decided_by: '', decision_note: '', action_version: 3, payload_hash: 'sha256:abc',
  action_payload: { actionType: 'register_schedule', version: 3, mode: 'real', artifact: { type: 'studio_project', id: 'studio-1', version: 3, scriptId: 'script-3' }, contentSnapshot: { title: 'Vision Sensor overview', caption: 'Verified facts' }, contentPayloadHash: 'a'.repeat(64), targetAccount: { id: 'account-1', label: 'TikTok 主账号', platform: 'tiktok' }, scheduledAt: '2099-01-03T08:00:00Z', estimatedCost: 1.5, risk: 'high', reversibility: 'reversible_before_publish', expiresAt: '2099-01-02T08:00:00Z', nextStep: '创建安全排期记录', schedulePayload: { caption: 'v3' } },
  expires_at: '2099-01-02T08:00:00Z', created_at: '2025-01-01T00:00:00Z', decided_at: '',
};
const snapshot = selectApprovalSnapshot(approval, new Date('2025-01-01T00:00:00Z'));
assert.equal(snapshot.canDecide, true);
assert.deepEqual(snapshot.targetAccounts, [{ id: 'account-1', platform: 'tiktok', name: 'TikTok 主账号' }]);
assert.equal(snapshot.contentVersion, '3');
assert.deepEqual(snapshot.materialVersions, ['script-3']);
assert.equal(snapshot.estimatedCost, 1.5);
assert.equal(selectApprovalSnapshot({ ...approval, payload_hash: '' }, new Date('2025-01-01T00:00:00Z')).canDecide, false);
assert.equal(selectApprovalSnapshot({ ...approval, expires_at: '2024-01-01T00:00:00Z' }, new Date('2025-01-01T00:00:00Z')).expired, true);

assert.deepEqual(parseApprovalChanges('{"caption":"v4"}').changes, { caption: 'v4' });
assert.ok(parseApprovalChanges('[]').error);
assert.deepEqual(buildObjectDiff({ caption: 'v3', account: 'a' }, { caption: 'v4' }), [{ path: 'caption', before: 'v3', after: 'v4' }]);

const goal: WeeklyGoal = { id: 'g', title: 'goal', objective: '', metric: 'inquiries', baseline: 2, target: 10, unit: '条', startsAt: '2025-01-01', endsAt: '2025-01-07', scope: '', budgetLimit: 10, constraints: [], status: 'completed', version: 1, createdAt: '', updatedAt: '' };
const workflowOnlyReview: WeeklyReview = { id: 'review', status: 'generated', created_at: '', summary: { completionRate: 100, automationRate: 80 } };
const missingOutcome = selectBusinessOutcome(workflowOnlyReview, goal);
assert.equal(missingOutcome.progressRate, null, 'workflow completion must never imply business-goal progress');
assert.match(missingOutcome.missingReason, /不能从任务完成率推断/);
const measuredReview: WeeklyReview = { ...workflowOnlyReview, summary: { ...workflowOnlyReview.summary, businessGoal: { status: 'observing', metric: 'inquiries', baseline: 2, target: 10, current: 6, unit: '条', source: 'social_metrics', sourceStatus: 'available' } } };
assert.equal(selectBusinessOutcome(measuredReview, goal).progressRate, 50);
const evidenceBackedReview: WeeklyReview = { ...workflowOnlyReview, summary: { workflow: { status: 'completed', completionRate: 100, completedTasks: 6, totalTasks: 6, failedTasks: 0, skippedTasks: 0, approvalCount: 1, handoffCount: 0, actualCost: 2 }, businessOutcome: { status: 'in_progress', metric: 'inquiries', baseline: 2, target: 10, observedValue: 5, measuredIncrement: 3, progressPercent: 37.5, source: 'posts.inquiries', dataQuality: 'verified', window: { startsAt: '2025-01-01', endsAt: '2025-01-07' }, explanation: '观察窗口仍在进行' }, publishing: { scheduled: 1, published: 1, dryRuns: 0, failed: 0, postIds: ['post-1'] } } };
assert.equal(selectBusinessOutcome(evidenceBackedReview, goal).progressRate, 37.5);
assert.equal(selectBusinessOutcome(evidenceBackedReview, goal).label, '观察中');

console.log('digital employee selector tests passed');
