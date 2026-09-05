import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isScheduledPostDue } from '../publishing/scheduledPublisher.js';
import {
  buildWeeklyPlan,
  normalizeDigitalEmployeeConfig,
  normalizeWeeklyGoal,
  validateDigitalEmployeeConfig,
} from './domain.js';
import { buildPublishingApprovalPackage } from './publishingExecution.js';

const base = normalizeDigitalEmployeeConfig({
  companyName: '无发布账号企业',
  industry: '智能制造',
  primaryBusiness: '工业设备出口',
  targetMarkets: '欧洲',
  customerProfile: '采购负责人',
  focusProducts: '检测设备',
  autonomyMode: 'managed',
  approvalOwner: '市场负责人',
  constraints: ['禁止虚构平台回执'],
  team: ['planner', 'content', 'risk', 'review'],
  primaryGoal: 'leads',
  enabledWorkflows: ['product_content', 'content_publish'],
  publishingTargets: [],
  allowRealPublishing: true,
  allowRealCustomerMessages: false,
  socialCadence: '每周生成 2 条发布草稿',
  followupCadence: '每周五生成跟进批次',
  reviewSchedule: '周五 17:30',
});

assert.ok(
  validateDigitalEmployeeConfig(base).includes('发布平台与账号'),
  'a tenant with no connected publishing account must not activate content publishing, even if the consent flag was posted as true',
);

const contentOnly = normalizeDigitalEmployeeConfig({
  ...base,
  enabledWorkflows: ['product_content'],
  allowRealPublishing: false,
});
assert.ok(!validateDigitalEmployeeConfig(contentOnly).includes('发布平台与账号'));
const goal = normalizeWeeklyGoal({
  businessLine: 'content_growth',
  title: '首周内容准备',
  objective: '先完成可审核的内容资产',
  metric: 'completed_content',
  target: 2,
  unit: '条',
  startsAt: '2026-09-07',
  endsAt: '2026-09-13',
  scope: '欧洲采购负责人',
}, contentOnly);
const safePlan = buildWeeklyPlan(goal, contentOnly);
assert.ok(safePlan.tasks.some(task => task.key === 'content_production'));
assert.ok(!safePlan.tasks.some(task => ['content_release_approval', 'publishing_calendar', 'platform_publish'].includes(task.key)));

const emptyPackage = buildPublishingApprovalPackage({
  projects: [{
    id: 'project-1',
    title: '已完成成片',
    status: 'completed',
    spec: { renderOutputPath: '/isolated/final.mp4', caption: '真实文案' },
  }],
  targets: [],
  goalPlatforms: ['youtube'],
  allowRealPublishing: true,
  now: new Date('2026-09-04T00:00:00.000Z'),
});
assert.equal(emptyPackage.items.length, 0, 'no account means no approvable publishing subject and no calendar materialization input');

const route = fs.readFileSync(new URL('../routes/digitalEmployees.ts', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../../src/components/DigitalEmployeePage.tsx', import.meta.url), 'utf8');
assert.match(route, /selected_publishing_accounts[\s\S]*ready:\s*packageAccountIds\.length > 0/, 'content approval preflight must stop when the frozen package has no account');
assert.match(route, /publishing_accounts_invalid/, 'goal activation and approval must expose a stable disconnected-account error');
assert.match(page, /本周暂不发布，仅生成内容/, 'a new tenant must have an explicit safe path that keeps content creation but removes publishing tasks');

assert.equal(
  isScheduledPostDue({
    id: 'post-1',
    tenant_id: 'tenant-isolated',
    content_id: 'project-1',
    platform: 'youtube',
    track_code: 'V1000',
    title: '不得发送',
    published_at: '2026-09-03T00:00:00.000Z',
    inquiries: 0,
    deals: 0,
    stats: {
      status: 'scheduled',
      workflowRunId: 'run-1',
      realPublishingAuthorized: false,
      targetAccountIds: [],
    },
  }, Date.parse('2026-09-04T00:00:00.000Z')),
  false,
  'the background publisher must never pick an unauthorized workflow post',
);

console.log('publishing no-account safety tests passed');
