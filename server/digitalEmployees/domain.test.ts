import assert from 'node:assert/strict';
import './contentBatchPlan.test.js';
import './contentReview.test.js';
import {
  buildTaskOutput,
  buildWeeklyPlan,
  buildWeeklyReview,
  normalizeDigitalEmployeeConfig,
  normalizeWeeklyGoal,
  validateDigitalEmployeeConfig,
  validateWeeklyGoal,
  type DigitalEmployeeConfig,
} from './domain.js';

const config = normalizeDigitalEmployeeConfig({
  companyName: '灵枢测试企业',
  industry: '智能制造',
  primaryBusiness: '面向海外客户提供工业设备',
  targetMarkets: '东南亚与欧洲',
  customerProfile: '工厂采购负责人',
  autonomyMode: 'managed',
  approvalOwner: '市场负责人',
  constraints: ['对外发布必须审批'],
  team: ['planner', 'knowledge', 'content', 'risk', 'review'],
  primaryGoal: 'leads',
  focusProducts: '工业检测设备',
  enabledWorkflows: ['scheduled_social', 'viral_clone', 'product_content', 'material_content', 'content_publish', 'customer_segmentation', 'batch_followup'],
  publishingTargets: [{ platform: 'youtube', accountId: 'youtube-account-1', accountLabel: '测试频道' }],
  allowRealPublishing: false,
  allowRealCustomerMessages: false,
  socialCadence: '每天 08:30 采集，每周发布 5 条',
  followupCadence: '每周五生成跟进批次',
  reviewSchedule: '周五 17:30',
  approvalPolicy: { contentPublish: true, batchFollowup: true, commercialCommitment: true },
});

assert.deepEqual(validateDigitalEmployeeConfig(config), []);
assert.equal(config.allowGeneratedVisuals, false, 'generated visuals require explicit consent');
assert.deepEqual(config.videoLanguages, ['en'], 'legacy configuration keeps one autonomous output language');
assert.deepEqual(normalizeDigitalEmployeeConfig({ ...config, videoLanguages: ['zh', 'en', 'zh', 'invalid'] }).videoLanguages, ['zh', 'en']);
assert.deepEqual(config.team, ['business', 'industry', 'content', 'customer'], 'only the four business-facing Agents may be exposed');
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
  constraints: ['禁止虚构认证'],
}, config);

assert.deepEqual(validateWeeklyGoal(goal), []);
const plan = buildWeeklyPlan(goal, config);
const expectedTaskKeys = [
  'context_readiness',
  'goal_decomposition',
  'scheduled_source_collection',
  'viral_analysis',
  'content_mode_routing',
  'content_production',
  'content_quality_gate',
  'content_release_approval',
  'publishing_calendar',
  'platform_publish',
  'customer_attribution',
  'customer_segmentation',
  'followup_batch_draft',
  'followup_batch_approval',
  'followup_dispatch',
  'weekly_review',
];
assert.deepEqual(plan.tasks.map(task => task.key), expectedTaskKeys, 'the approved P0 workflow must remain a 16-node business DAG');
assert.equal(new Set(plan.tasks.map(task => task.sequence)).size, 16, 'task sequence numbers must be unique');
assert.deepEqual([...new Set(plan.tasks.map(task => task.agentRole))].sort(), ['business', 'content', 'customer', 'industry']);
assert.equal(plan.tasks.some(task => ['knowledge', 'planner', 'risk', 'channel', 'review'].includes(task.agentRole)), false);

const byKey = new Map(plan.tasks.map(task => [task.key, task]));
assert.equal(byKey.get('content_production')?.executionMode, 'draft_executor');
for (const task of plan.tasks) {
  assert.ok(task.businessDomain, `${task.key} must identify its business domain`);
  assert.ok(task.capabilityKey, `${task.key} must bind an existing business capability`);
  assert.ok(task.destination, `${task.key} must deep-link to an existing workspace`);
  assert.ok(task.statusSource, `${task.key} must name its real status source`);
  for (const dependency of task.dependsOn) {
    const upstream = byKey.get(dependency);
    assert.ok(upstream, `${task.key} has an unknown dependency: ${dependency}`);
    assert.ok(upstream!.sequence < task.sequence, `${task.key} must not depend on a later task`);
  }
}

assert.equal(plan.tasks.filter(task => task.requiresApproval).length, 2);
assert.equal(byKey.get('content_release_approval')?.requiresApproval, true);
assert.equal(byKey.get('followup_batch_approval')?.requiresApproval, true);
assert.deepEqual(byKey.get('publishing_calendar')?.dependsOn, ['content_release_approval']);
assert.deepEqual(byKey.get('followup_dispatch')?.dependsOn, ['followup_batch_approval']);
assert.deepEqual(
  { destination: byKey.get('scheduled_source_collection')?.destination, view: byKey.get('scheduled_source_collection')?.destinationView },
  { destination: 'scheduled', view: undefined },
  'business automation belongs to Scheduler',
);
assert.deepEqual(
  { destination: byKey.get('publishing_calendar')?.destination, view: byKey.get('publishing_calendar')?.destinationView },
  { destination: 'smartAssets', view: 'publish' },
  'publishing calendar must not be confused with Scheduler',
);
assert.equal(byKey.get('customer_segmentation')?.destination, 'conversion');
assert.ok(plan.successCriteria.some(item => item.includes('approved_content_packages')));

function assertValidPlanGraph(workflows: DigitalEmployeeConfig['enabledWorkflows'], expectedKeys: string[]) {
  const variant = normalizeDigitalEmployeeConfig({ ...config, enabledWorkflows: workflows });
  const variantPlan = buildWeeklyPlan(goal, variant);
  assert.deepEqual(variantPlan.tasks.map(task => task.key), expectedKeys);
  assert.deepEqual(variantPlan.tasks.map(task => task.sequence), expectedKeys.map((_, index) => index + 1), 'filtered plans must retain contiguous display order');
  const keys = new Set(expectedKeys);
  for (const task of variantPlan.tasks) {
    assert.ok(task.dependsOn.every(key => keys.has(key)), `${task.key} must not depend on a disabled workflow node`);
  }
  return new Map(variantPlan.tasks.map(task => [task.key, task]));
}

const productOnly = assertValidPlanGraph(['product_content'], [
  'context_readiness', 'goal_decomposition', 'content_mode_routing', 'content_production', 'content_quality_gate', 'weekly_review',
]);
assert.deepEqual(productOnly.get('content_mode_routing')?.dependsOn, ['goal_decomposition']);
assert.deepEqual(productOnly.get('weekly_review')?.dependsOn, ['content_quality_gate']);

assertValidPlanGraph(['scheduled_social'], [
  'context_readiness', 'goal_decomposition', 'scheduled_source_collection', 'weekly_review',
]);

const followupOnly = assertValidPlanGraph(['batch_followup'], [
  'context_readiness', 'goal_decomposition', 'customer_segmentation', 'followup_batch_draft', 'followup_batch_approval', 'followup_dispatch', 'weekly_review',
]);
assert.deepEqual(followupOnly.get('customer_segmentation')?.dependsOn, ['goal_decomposition']);
assert.deepEqual(followupOnly.get('weekly_review')?.dependsOn, ['followup_dispatch']);

const publishOnly = assertValidPlanGraph(['content_publish'], [
  'context_readiness', 'goal_decomposition', 'content_release_approval', 'publishing_calendar', 'platform_publish', 'weekly_review',
]);
assert.deepEqual(publishOnly.get('content_release_approval')?.dependsOn, ['goal_decomposition']);

assertValidPlanGraph([], ['context_readiness', 'goal_decomposition', 'weekly_review']);

const contentGoal = normalizeWeeklyGoal({
  ...goal,
  businessLine: 'content_growth',
  contentPlatforms: ['facebook', 'instagram', 'tiktok', 'youtube'],
}, config);
const contentPlan = buildWeeklyPlan(contentGoal, config);
assert.ok(contentPlan.tasks.some(task => task.businessDomain === 'content'), 'content growth must retain content work');
assert.ok(contentPlan.tasks.some(task => task.businessDomain === 'publishing'), 'content growth must retain publishing work');
assert.ok(!contentPlan.tasks.some(task => task.businessDomain === 'customer'), 'content growth must not mix in customer follow-up work');
assert.deepEqual(buildTaskOutput('scheduled_source_collection', contentGoal, config).platforms, ['facebook', 'instagram', 'tiktok', 'youtube']);

const customerGoal = normalizeWeeklyGoal({ ...goal, businessLine: 'customer_conversion' }, config);
const customerPlan = buildWeeklyPlan(customerGoal, config);
assert.ok(customerPlan.tasks.some(task => task.businessDomain === 'customer'), 'customer conversion must retain customer work');
assert.ok(!customerPlan.tasks.some(task => ['content', 'publishing'].includes(task.businessDomain)), 'customer conversion must not mix in content production work');
assert.deepEqual(customerPlan.tasks.find(task => task.key === 'customer_segmentation')?.dependsOn, ['goal_decomposition']);

const contentRouting = buildTaskOutput('content_mode_routing', goal, config);
assert.equal(contentRouting.routingSource, 'content_batch_plans.orders');
assert.equal('modes' in contentRouting, false, '路径不得用静态 modes 冒充已生成订单');
assert.equal(contentRouting.destination, 'smartAssets/create');
const production = buildTaskOutput('content_production', goal, config);
assert.equal(production.completedWorkIsPublished, false, 'a rendered work must never be reported as published');
const calendar = buildTaskOutput('publishing_calendar', goal, config);
assert.equal(calendar.scheduledIsPublished, false, 'a calendar item must never be reported as published');
const publish = buildTaskOutput('platform_publish', goal, config);
assert.equal(publish.externalPublishPerformed, false, 'no provider receipt means no published result');
const followupDraft = buildTaskOutput('followup_batch_draft', goal, config);
assert.equal(followupDraft.safetyMode, 'per_customer_draft');
assert.equal(followupDraft.messagesSent, 0, 'draft generation must not send messages');
const followupApproval = buildTaskOutput('followup_batch_approval', goal, config);
assert.equal(followupApproval.commercialCommitmentsRequireIndividualReview, true);
assert.equal(followupApproval.messagesSent, 0, 'approval preparation must not send messages');
const followupDispatch = buildTaskOutput('followup_dispatch', goal, config);
assert.equal(followupDispatch.bulkWorkerStatus, 'manual_or_scheduled');
assert.equal(followupDispatch.messagesSent, 0, 'a connected worker must still wait for a real provider receipt');
const nextWeek = buildTaskOutput('weekly_review', goal, config);
assert.equal(nextWeek.nextWeekPlanCreated, false, 'review may suggest but must not silently create or start next week');

const review = buildWeeklyReview({ goal, totalTasks: 16, completedTasks: 16, approvalCount: 2, handoffCount: 1, failedTasks: 0 });
assert.equal(review.completionRate, 100);
assert.equal(review.automationRate, 88);
assert.equal(review.approvalRate, 13);
assert.equal(review.handoffRate, 6);

console.log('digital employee domain tests passed');
