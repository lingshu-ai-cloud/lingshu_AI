import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ApprovalRequest, DigitalEmployeeConfig, RunEvent, WeeklyGoal, WeeklyPlan, WeeklyReview, WorkflowRun, WorkflowTask, WorkItem } from '../../lib/digitalEmployees.js';
import { DashboardHeader } from './DashboardHeader.js';
import { OverviewCards } from './OverviewCards.js';
import { PlanSummary } from './PlanSummary.js';
import { ProductionFeed } from './ProductionFeed.js';
import { TaskDetailDrawer } from './TaskDetailDrawer.js';
import { WeeklyReviewSummary } from './WeeklyReviewSummary.js';
import { WorkInbox } from './WorkInbox.js';

const config: DigitalEmployeeConfig = { companyName: '灵枢', industry: '制造', primaryBusiness: '设备', targetMarkets: '欧洲', customerProfile: '采购', autonomyMode: 'managed', weeklyBudget: 500, approvalOwner: 'owner', constraints: ['真实发布需审批'], team: ['planner'] };
const goal: WeeklyGoal = { id: 'g1', title: '获得真实询盘', objective: '增长', metric: 'inquiries', baseline: 0, target: 5, unit: '条', startsAt: '2025-01-01', endsAt: '2025-01-07', scope: '欧洲', budgetLimit: 500, constraints: [], status: 'active', version: 1, createdAt: '', updatedAt: '' };
const run: WorkflowRun = { id: 'r1', goal_id: 'g1', plan_id: 'p1', status: 'running', current_controller: 'agent', pause_reason: '', budget_limit: 500, budget_spent: 1, started_at: '', completed_at: '' };
const makeTask = (id: string, title: string, status: string, sequence: number): WorkflowTask => ({ id, run_id: 'r1', task_key: id, title, description: `${title}描述`, agent_role: 'content', kind: 'production', status, sequence, priority: 'medium', requires_approval: status === 'waiting_approval', depends_on: [], output: id === 'done' ? { artifactReference: { id: 'studio-1', type: 'Studio 草稿', deepLink: '/studio?id=studio-1' } } : {}, blocked_reason: '', owner_id: '', updated_at: '' });
const tasks = [makeTask('done', '成功任务默认隐藏', 'succeeded', 1), makeTask('approval-task', '发布动作审批', 'waiting_approval', 2)];
const plan: WeeklyPlan = { id: 'p1', status: 'approved', strategy: '读取事实后生成内容', successCriteria: [], estimatedCost: 2, estimatedMinutes: 20, qualityGates: [], riskSummary: '', tasks: [] };
const event: RunEvent = { id: 'e1', run_id: 'r1', task_id: 'approval-task', sequence: 7, type: 'approval.requested', level: 'warning', summary: '等待审批', payload: { raw: true }, occurred_at: '2025-01-01T00:00:00Z' };
const approval: ApprovalRequest = { id: 'a1', goal_id: 'g1', run_id: 'r1', task_id: 'approval-task', status: 'pending', action_summary: '批准排期动作', risk_level: 'high', evidence: [], requested_by_agent: 'risk', owner_id: 'owner', decided_by: '', decision_note: '', action_version: 2, payload_hash: 'sha256:exact', action_payload: { action_type: 'register_schedule', parameters: { caption: 'v2' }, content_version: 'content-v2', material_versions: [], contentSnapshot: { title: 'Vision Sensor overview', caption: 'Verified facts', voiceover: ['Verified facts'] }, contentPayloadHash: 'a'.repeat(64), target_account_ids: ['linkedin-1'], scheduled_at: '2099-01-01T00:00:00Z', estimated_cost: 0, reversible: true, next_step: '创建待发布记录' }, expires_at: '2099-01-01T01:00:00Z', created_at: '', decided_at: '' };
const workItem: WorkItem = { id: 'a1', type: 'approval', status: 'pending', runId: 'r1', taskId: 'approval-task', ownerId: 'owner', agent: 'risk', risk: 'high', goalId: 'g1', dueAt: '2099-01-01T01:00:00Z' };
const review: WeeklyReview = { id: 'review', status: 'generated', created_at: '', summary: { workflow: { status: 'completed', completionRate: 100, completedTasks: 2, totalTasks: 2, failedTasks: 0, skippedTasks: 0, approvalCount: 1, handoffCount: 0, actualCost: 1 }, businessOutcome: { status: 'awaiting_measurement', metric: 'inquiries', baseline: 0, target: 5, observedValue: null, measuredIncrement: null, progressPercent: null, source: 'posts.inquiries', dataQuality: 'unavailable', window: { startsAt: '2025-01-01', endsAt: '2025-01-07' }, explanation: '渠道未返回指标' }, publishing: { scheduled: 0, published: 0, dryRuns: 1, failed: 0, postIds: [] } } };

const header = renderToStaticMarkup(<DashboardHeader config={config} stage={5} workItemCount={1} streamPhase="connected" onEditConfig={() => {}} />);
for (let stage = 1; stage <= 6; stage += 1) assert.match(header, new RegExp(`href="#digital-stage-${stage}"`));
assert.match(header, /待我处理 1/);
assert.match(header, /实时已连接/);

const overview = renderToStaticMarkup(<OverviewCards goal={goal} run={run} tasks={tasks} review={null} />);
assert.match(overview, /工作流完成率/);
assert.match(overview, /经营目标达成/);
assert.match(overview, /不能从任务完成率推断经营结果/);

const planMarkup = renderToStaticMarkup(<PlanSummary plan={plan} tasks={tasks} onSelectTask={() => {}} />);
assert.match(planMarkup, /已完成任务 1 项/);
assert.doesNotMatch(planMarkup, /成功任务默认隐藏/);
assert.match(planMarkup, /发布动作审批/);

const feed = renderToStaticMarkup(<ProductionFeed events={[event]} connection={{ phase: 'reconnecting', attempt: 2, retryInMs: 1000 }} onRefresh={() => {}} onSelectEvent={() => {}} />);
assert.match(feed, /断线补偿中/);
assert.match(feed, /有一项动作等待你处理/);
assert.doesNotMatch(feed, /#7/);

const inbox = renderToStaticMarkup(<WorkInbox items={[workItem]} approvals={[approval]} tasks={tasks} goals={[goal]} busy={false} onDecide={() => {}} onHandoff={() => {}} onSelectTask={() => {}} onTransfer={() => {}} onTaskAction={() => {}} onReturnHandoff={() => {}} onPublishingReconciliation={() => {}} />);
assert.match(inbox, /精确动作审批/);
assert.match(inbox, /sha256:exact/);
assert.match(inbox, /linkedin-1/);
assert.match(inbox, /批准后下一步/);
assert.match(inbox, /批准并继续/);

const historicalInbox = renderToStaticMarkup(<WorkInbox items={[{ ...workItem, runId: 'historical-run', approval }]} approvals={[]} tasks={[]} goals={[goal]} busy={false} onDecide={() => {}} onHandoff={() => {}} onSelectTask={() => {}} onTransfer={() => {}} onTaskAction={() => {}} onReturnHandoff={() => {}} onPublishingReconciliation={() => {}} />);
assert.match(historicalInbox, /精确动作审批/);
assert.match(historicalInbox, /sha256:exact/);

const reconciliationItem: WorkItem = { id: 'publishing-reconciliation:post-1', type: 'publishing_reconciliation', status: 'pending', sourceStatus: 'needs_reconciliation', source: 'post', runId: 'r1', taskId: '', ownerId: '', agent: 'publishing', risk: 'high', goalId: '', dueAt: '', title: '发布结果待对账', summary: '调用超时', postId: 'post-1', expectedRevision: 7, targetAccountIds: ['tiktok-main', 'youtube-main'], allowedDecisions: ['confirm_published', 'confirm_not_published_retry', 'void'], blindRetryAllowed: false };
const reconciliationInbox = renderToStaticMarkup(<WorkInbox items={[reconciliationItem]} approvals={[]} tasks={[]} goals={[goal]} busy={false} onDecide={() => {}} onHandoff={() => {}} onSelectTask={() => {}} onTransfer={() => {}} onTaskAction={() => {}} onReturnHandoff={() => {}} onPublishingReconciliation={() => {}} />);
assert.match(reconciliationInbox, /发布结果人工对账/);
assert.match(reconciliationInbox, /禁止 blind retry/);
assert.match(reconciliationInbox, /tiktok-main/);
assert.match(reconciliationInbox, /youtube-main/);
assert.match(reconciliationInbox, /不预设结论/);
assert.match(reconciliationInbox, /提交对账决定/);
const busyReconciliationInbox = renderToStaticMarkup(<WorkInbox items={[reconciliationItem]} approvals={[]} tasks={[]} goals={[goal]} busy onDecide={() => {}} onHandoff={() => {}} onSelectTask={() => {}} onTransfer={() => {}} onTaskAction={() => {}} onReturnHandoff={() => {}} onPublishingReconciliation={() => {}} />);
assert.match(busyReconciliationInbox, /提交中，请勿重复操作/);

const reviewMarkup = renderToStaticMarkup(<WeeklyReviewSummary review={review} goal={goal} run={{ ...run, status: 'succeeded' }} onCreateNextGoal={() => {}} />);
assert.match(reviewMarkup, /工作流完成率/);
assert.match(reviewMarkup, /经营目标达成率/);
assert.match(reviewMarkup, /经营指标缺失态/);

const drawer = renderToStaticMarkup(<TaskDetailDrawer task={tasks[0]} selectedEvent={event} events={[event]} onClose={() => {}} />);
assert.match(drawer, /role="dialog"/);
assert.match(drawer, /aria-modal="true"/);
assert.match(drawer, /aria-label="关闭详情"/);
assert.match(drawer, /Studio 草稿/);
assert.match(drawer, /技术详情/);

console.log('digital employee component contract tests passed');
