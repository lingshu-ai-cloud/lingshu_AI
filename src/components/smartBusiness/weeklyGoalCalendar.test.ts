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
console.log('Weekly goal calendar projects persisted task capabilities and status sources');
