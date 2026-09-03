import assert from 'node:assert/strict';
import {
  buildTaskOutput,
  buildWeeklyPlan,
  buildWeeklyReview,
  normalizeDigitalEmployeeConfig,
  normalizeWeeklyGoal,
  validateDigitalEmployeeConfig,
  validateWeeklyGoal,
  canPerformDigitalEmployeeAction,
  canTransition,
  parseApprovalDecision,
  RUN_TRANSITIONS,
  TASK_TRANSITIONS,
} from './domain.js';

const config = normalizeDigitalEmployeeConfig({
  companyName: '灵枢测试企业',
  industry: '智能制造',
  primaryBusiness: '面向海外客户提供工业设备',
  targetMarkets: '东南亚与欧洲',
  customerProfile: '工厂采购负责人',
  autonomyMode: 'managed',
  weeklyBudget: 600,
  approvalOwner: '市场负责人',
  constraints: ['对外发布必须审批'],
  team: ['planner', 'knowledge', 'content', 'risk', 'review'],
});

assert.deepEqual(validateDigitalEmployeeConfig(config), []);
assert.deepEqual(validateDigitalEmployeeConfig({ ...config, companyName: '', approvalOwner: '' }), ['企业名称', '审批负责人']);

const goal = normalizeWeeklyGoal({
  title: '本周内容增长',
  objective: '形成可审批的海外内容执行包',
  metric: 'approved_content_packages',
  baseline: 0,
  target: 5,
  unit: '项',
  startsAt: '2026-09-02',
  endsAt: '2026-09-08',
  scope: '德国工业设备采购市场',
  budgetLimit: 500,
  constraints: ['禁止虚构认证'],
}, config);

assert.deepEqual(validateWeeklyGoal(goal), []);
const plan = buildWeeklyPlan(goal, config);
assert.equal(plan.tasks.length, 6);
assert.equal(plan.tasks.filter(task => task.requiresApproval).length, 1);
assert.equal(plan.tasks.find(task => task.key === 'brand_risk_approval')?.agentRole, 'risk');
assert.deepEqual(plan.tasks.find(task => task.key === 'schedule_activation')?.dependsOn, ['brand_risk_approval']);
assert.ok(plan.successCriteria.some(item => item.includes('approved_content_packages')));

const executionPack = buildTaskOutput('content_execution_pack', goal, config);
assert.equal(Array.isArray(executionPack.themes), true);
assert.equal(executionPack.approvalRequired, true);
const activation = buildTaskOutput('schedule_activation', goal, config);
assert.equal(activation.externalPublishPerformed, false);

const review = buildWeeklyReview({ goal, totalTasks: 6, completedTasks: 6, approvalCount: 1, handoffCount: 1, failedTasks: 0 });
assert.equal(review.completionRate, 100);
assert.equal(review.automationRate, 83);
assert.equal(review.approvalRate, 17);
assert.equal(review.handoffRate, 17);

assert.equal(parseApprovalDecision(undefined), null);
assert.equal(parseApprovalDecision('yes'), null);
assert.equal(parseApprovalDecision('approved'), 'approved');
assert.equal(parseApprovalDecision('approved_with_changes'), 'approved_with_changes');
assert.equal(canPerformDigitalEmployeeAction({ action: 'configure', userId: 'u1', supportAccess: true }), false);
assert.equal(canPerformDigitalEmployeeAction({ action: 'decide_approval', userId: 'u1', ownerId: 'u2' }), false);
assert.equal(canPerformDigitalEmployeeAction({ action: 'decide_approval', userId: 'u1', ownerId: 'u1' }), true);
assert.equal(canTransition(RUN_TRANSITIONS, 'succeeded', 'running'), false);
assert.equal(canTransition(RUN_TRANSITIONS, 'paused', 'running'), true);
assert.equal(canTransition(TASK_TRANSITIONS, 'waiting_approval', 'succeeded'), true);
assert.equal(canTransition(TASK_TRANSITIONS, 'succeeded', 'pending'), false);
assert.equal(canTransition(TASK_TRANSITIONS, 'failed', 'skipped'), true);
assert.equal(canTransition(RUN_TRANSITIONS, 'failed', 'running'), true);

console.log('digital employee domain tests passed');
