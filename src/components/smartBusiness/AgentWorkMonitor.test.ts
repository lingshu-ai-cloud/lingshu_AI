import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import type { ContentQueueItem } from '../../lib/digitalEmployees';
import { projectAgentWorkMonitor } from './AgentWorkMonitor';

function queueItem(overrides: Partial<ContentQueueItem> = {}): ContentQueueItem {
  return {
    id: 'content-1', contentId: 'content-1', orderId: 'order-1', batchPlanId: 'batch-1', projectIds: [], taskId: 'task-1', socialContentTaskId: 'social-1',
    origin: 'weekly_plan', lineage: {} as ContentQueueItem['lineage'], outputSummary: { count: 1, durationSeconds: null, formats: [] },
    title: '产品短视频', productName: '产品 A', platform: 'tiktok', accountId: 'account-1', accountLabel: 'TikTok 主账号', route: 'clone', languages: ['en'],
    plannedPublishDate: '2026-10-10', referenceId: '', referenceTitle: '', referenceViews: '', benchmarkAccount: '', matchScore: null, planningFactors: [],
    status: 'producing', stage: '脚本生成', progress: 10, reason: '', updatedAt: '2026-10-10T10:30:00.000Z', estimatedCostCny: null, settledCostCny: null, costStatus: 'unavailable',
    steps: [
      { key: 'script', label: '生成企业适配脚本', state: 'active', responsibleAgent: '编导 Agent', estimatedMinutes: 30, actualStartedAt: '2026-10-10T10:00:00.000Z' },
      { key: 'assets', label: '匹配逐镜素材', state: 'pending', responsibleAgent: '内容 Agent', estimatedMinutes: 45 },
    ],
    ...overrides,
  } as ContentQueueItem;
}

test('projects four fixed agents from real active and pending queue steps', () => {
  const rows = projectAgentWorkMonitor([queueItem()], Date.parse('2026-10-10T10:42:00.000Z'));
  assert.deepEqual(rows.map(row => row.name), ['经营 Agent', '编导 Agent', '内容 Agent', '客服 Agent']);
  const director = rows.find(row => row.role === 'director')!;
  assert.equal(director.status, 'working');
  assert.equal(director.assignments[0]?.stepLabel, '生成企业适配脚本');
  assert.equal(director.assignments[0]?.elapsedMinutes, 42);
  assert.equal(director.assignments[0]?.estimatedMinutes, 30);
  const content = rows.find(row => row.role === 'content')!;
  assert.equal(content.status, 'queued');
  assert.equal(content.nextAssignment?.stepLabel, '匹配逐镜素材');
  assert.equal(rows.find(row => row.role === 'customer')?.status, 'standby');
});

test('does not invent elapsed time without a valid actual start receipt', () => {
  const item = queueItem({ steps: [{ key: 'script', label: '生成企业适配脚本', state: 'active', responsibleAgent: '编导 Agent', estimatedMinutes: 30 }] });
  const director = projectAgentWorkMonitor([item], Date.parse('2026-10-10T10:42:00.000Z')).find(row => row.role === 'director')!;
  assert.equal(director.assignments[0]?.actualStartedAt, null);
  assert.equal(director.assignments[0]?.elapsedMinutes, null);
});

test('keeps a real blocked reason attached to the responsible agent lane', () => {
  const item = queueItem({ status: 'blocked', reason: '缺少产品授权证明' });
  const director = projectAgentWorkMonitor([item], Date.parse('2026-10-10T10:42:00.000Z')).find(row => row.role === 'director')!;
  assert.equal(director.status, 'needs_action');
  assert.equal(director.assignments[0]?.blockedReason, '缺少产品授权证明');
});

test('uses workflow runtime data for agents outside the content queue', () => {
  const rows = projectAgentWorkMonitor([], Date.parse('2026-10-10T10:42:00.000Z'), {
    workflowTasks: [{ id: 'customer-1', run_id: 'run-1', task_key: 'customer_followup', title: '整理今日询盘', description: '对新询盘分级并准备跟进', agent_role: 'customer', kind: 'customer', status: 'running', sequence: 1, priority: 'normal', requires_approval: false, depends_on: [], output: {}, blocked_reason: '', owner_id: '', updated_at: '2026-10-10T10:40:00.000Z' }],
    planTasks: [{ key: 'customer_followup', title: '整理今日询盘', description: '', agentRole: 'customer', kind: 'customer', sequence: 1, priority: 'normal', requiresApproval: false, dependsOn: [], expectedMinutes: 25 }],
  });
  const customer = rows.find(row => row.role === 'customer')!;
  assert.equal(customer.status, 'working');
  assert.equal(customer.assignments[0]?.taskTitle, '整理今日询盘');
  assert.equal(customer.assignments[0]?.estimatedMinutes, 25);
  assert.equal(customer.assignments[0]?.elapsedMinutes, null);
});

test('the old weekly-package empty-state copy and content-card grid stay removed', () => {
  const calendar = fs.readFileSync('src/components/smartBusiness/ConnectedAgentCalendar.tsx', 'utf8');
  const schedule = fs.readFileSync('src/components/smartBusiness/MatrixWorkSchedule.tsx', 'utf8');
  assert.doesNotMatch(calendar, /选择已有周包查看排期；无周包时需先生成经营周计划。/);
  assert.doesNotMatch(schedule, /内容任务执行进度/);
  assert.match(schedule, /<AgentWorkMonitor items=\{visibleTasks\}/);
});
