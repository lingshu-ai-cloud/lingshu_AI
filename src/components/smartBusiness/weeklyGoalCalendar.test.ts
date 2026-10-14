import assert from 'node:assert/strict';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import { projectWeeklyGoalCalendar } from './weeklyGoalCalendar';

const overview = {
  goal: {
    id: 'goal', title: '本周经营', startsAt: '2026-10-12', endsAt: '2026-10-18',
    videoPlans: [{ contentId: 'video', platform: 'tiktok', theme: '产品验证', plannedPublishDate: '2026-10-13', matrix: { accountId: 'tt' } }],
  },
  plan: {
    tasks: [
      { key: 'scheduled_source_collection', title: '真实采集', description: '创建采集任务', agentRole: 'director', expectedMinutes: 4, dependsOn: ['goal_decomposition'], capabilityKey: 'scheduler.social_collection', statusSource: 'crawl_jobs' },
      { key: 'viral_analysis', title: '真实分析', description: '分析采集结果', agentRole: 'director', expectedMinutes: 8, dependsOn: ['scheduled_source_collection'], capabilityKey: 'inspiration.exact_analysis', statusSource: 'trend_videos.aiAnalysis' },
      { key: 'platform_publish', title: '真实发布', description: '等待发布回执', agentRole: 'business', expectedMinutes: 5, dependsOn: ['publishing_calendar'], capabilityKey: 'publishing.delivery', statusSource: 'publishResults' },
      { key: 'weekly_review', title: '真实复盘', description: '聚合真实指标', agentRole: 'business', expectedMinutes: 5, dependsOn: ['followup_dispatch'], capabilityKey: 'review.weekly_business', statusSource: 'weekly_reviews' },
    ],
  },
  run: null,
  tasks: [],
} as unknown as DigitalEmployeeOverview;

const calendar = projectWeeklyGoalCalendar(overview);
const director = calendar.find(task => task.id === 'goal-goal-director');
assert.deepEqual(director?.internalNodes?.map(task => task.id), ['goal-goal-scheduled_source_collection', 'goal-goal-viral_analysis']);
assert.equal(director?.internalNodes?.[0]?.context, 'scheduler.social_collection · 状态来源：crawl_jobs');
assert.ok(calendar.find(task => task.id === 'goal-goal-publishing')?.internalNodes?.some(task => task.id.endsWith('platform_publish')));
assert.ok(calendar.find(task => task.id === 'goal-goal-review')?.internalNodes?.some(task => task.id.endsWith('weekly_review')));
assert.equal(calendar.find(task => task.id === 'goal-goal-publish-video')?.date, '2026-10-13');

const productionPlanTasks = [
  { key: 'content_production', title: '制作成片', description: '完成素材与成片生产', agentRole: 'content', expectedMinutes: 30, dependsOn: ['content_mode_routing'], capabilityKey: 'studio.production', statusSource: 'studio_projects' },
  { key: 'content_quality_gate', title: '完成质量门', description: '完成质量验收', agentRole: 'content', expectedMinutes: 8, dependsOn: ['content_production'], capabilityKey: 'studio.quality_gate', statusSource: 'studio_projects' },
];
const processingOverview = {
  ...overview,
  plan: { ...overview.plan, tasks: [...overview.plan!.tasks, ...productionPlanTasks] },
  tasks: [{
    task_key: 'content_production', status: 'waiting_external', blocked_reason: '内容任务正在推进，等待制作或质检结果回写。',
    output: { waitState: { kind: 'processing', message: '正在推进', requiresAttention: false } },
  }],
} as unknown as DigitalEmployeeOverview;
const processingProduction = projectWeeklyGoalCalendar(processingOverview).find(task => task.id === 'goal-goal-production');
assert.equal(processingProduction?.status, 'active', 'background processing must render as in progress instead of an error');
assert.equal(processingProduction?.reason, undefined, 'a non-actionable processing message must not become a blocker');
assert.equal(processingProduction?.internalNodes?.[0]?.status, 'active');
assert.equal(processingProduction?.internalNodes?.[0]?.reason, undefined);

const inputOverview = {
  ...processingOverview,
  tasks: [{
    task_key: 'content_production', status: 'waiting_external', blocked_reason: '请补充人物素材',
    output: { waitState: { kind: 'input', message: '请补充人物素材', requiresAttention: true } },
  }],
} as unknown as DigitalEmployeeOverview;
const blockedProduction = projectWeeklyGoalCalendar(inputOverview).find(task => task.id === 'goal-goal-production');
assert.equal(blockedProduction?.status, 'blocked', 'real user input blockers must retain the error state');
assert.equal(blockedProduction?.internalNodes?.[0]?.status, 'blocked');
console.log('Weekly goal calendar projects persisted task capabilities and status sources');
