import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';
import { buildMobileWorkbenchOverview, createMobileWorkbenchOverviewRouter, mobileWorkbenchWeekRange } from './mobileWorkbenchOverview.js';

function mockStore(seed: Record<string, Record_[]>, failures = new Set<string>()): DataStore {
  return {
    getById: async <T>(collection: string, id: string) => (seed[collection] || []).find(row => row.id === id) as T || null,
    create: async <T>() => null as T | null,
    update: async () => false,
    delete: async () => false,
    list: async <T>(collection: string, query?: ListQuery) => {
      if (failures.has(collection)) throw Error(`${collection}_offline`);
      // Deliberately do not apply where: the overview boundary must re-check it.
      const all = (seed[collection] || []) as T[];
      const perPage = query?.perPage || 200; const page = query?.page || 1;
      return { items: all.slice((page - 1) * perPage, page * perPage), totalItems: all.length, totalPages: Math.max(1, Math.ceil(all.length / perPage)), page, perPage };
    },
  };
}

function fixtures() {
  const tasks: Record_[] = Array.from({ length: 205 }, (_, index) => ({
    id: `task-${String(index).padStart(3, '0')}`, tenant_id: 'tenant-a', goal_id: 'goal-week', run_id: 'run-a',
    task_key: index === 0 ? 'content_production' : 'weekly_review', agent_role: index === 0 ? 'content' : 'business',
    title: `任务 ${index}`, status: index < 3 ? 'succeeded' : index === 3 ? 'running' : 'skipped',
    created_at: '2026-10-06T01:00:00Z', updated_at: `2026-10-06T${String(index % 20).padStart(2, '0')}:00:00Z`,
  }));
  tasks.push({ id: 'open-old', tenant_id: 'tenant-a', goal_id: 'goal-old', run_id: 'run-old', task_key: 'followup_dispatch', agent_role: 'customer', title: '持续跟进', status: 'waiting_external', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-10-09T03:00:00Z' });
  tasks.push({ id: 'long-goal-history', tenant_id: 'tenant-a', goal_id: 'goal-long', run_id: 'run-long', task_key: 'weekly_review', agent_role: 'business', title: '跨周目标历史任务', status: 'succeeded', created_at: '2026-09-10T00:00:00Z', updated_at: '2026-09-10T03:00:00Z' });
  tasks.push({ id: 'long-goal-this-week', tenant_id: 'tenant-a', goal_id: 'goal-long', run_id: 'run-long', task_key: 'content_production', agent_role: 'content', title: '跨周目标本周任务', status: 'running', created_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-09T03:00:00Z' });
  tasks.push({ id: 'leaked', tenant_id: 'tenant-b', goal_id: 'goal-week', status: 'running', title: '其他租户', created_at: '2026-10-06T00:00:00Z' });
  return {
    weekly_goals: [
      { id: 'goal-week', tenant_id: 'tenant-a', starts_at: '2026-10-05', ends_at: '2026-10-11' },
      { id: 'goal-long', tenant_id: 'tenant-a', starts_at: '2026-09-01', ends_at: '2026-10-31' },
      { id: 'goal-old', tenant_id: 'tenant-a', starts_at: '2026-09-01', ends_at: '2026-09-07' },
      { id: 'goal-private', tenant_id: 'tenant-b', starts_at: '2026-10-05', ends_at: '2026-10-11' },
    ],
    workflow_tasks: tasks,
    posts: [
      { id: 'scheduled', tenant_id: 'tenant-a', title: '排期内容', platform: 'tiktok', published_at: '2026-10-08T02:00:00Z', stats: { status: 'scheduled' } },
      { id: 'published', tenant_id: 'tenant-a', title: '已发布内容', platform: 'youtube', published_at: '2026-10-09T02:00:00Z', task_id: 'task-000', content_id: 'content-1', stats: { status: 'published', publishResults: { youtube: { postId: 'yt-1' } } } },
      { id: 'private-post', tenant_id: 'tenant-b', published_at: '2026-10-09T02:00:00Z', platform_post_id: 'secret' },
    ],
    social_interaction_writebacks: [
      { id: 'inquiry-qualified', tenant_id: 'tenant-a', kind: 'inquiry', occurredAt: '2026-10-07T02:00:00Z', platform: 'whatsapp', accountId: 'wa-1', contentId: '' },
      { id: 'inquiry-reversed', tenant_id: 'tenant-a', kind: 'direct_message', occurredAt: '2026-10-08T02:00:00Z', platform: 'instagram', accountId: 'ig-1', contentId: 'post-1' },
      { id: 'private-inquiry', tenant_id: 'tenant-b', kind: 'inquiry', occurredAt: '2026-10-07T02:00:00Z' },
    ],
    social_sales_qualifications: [
      { id: 'q1', tenant_id: 'tenant-a', interaction_id: 'inquiry-qualified', status: 'qualified', authority: 'sales', confirmed_at: '2026-10-08T00:00:00Z' },
      { id: 'q2', tenant_id: 'tenant-a', interaction_id: 'inquiry-reversed', status: 'qualified', authority: 'sales', confirmed_at: '2026-10-08T00:00:00Z' },
      { id: 'q3', tenant_id: 'tenant-a', interaction_id: 'inquiry-reversed', status: 'disqualified', authority: 'sales', confirmed_at: '2026-10-09T00:00:00Z' },
      { id: 'private-q', tenant_id: 'tenant-b', interaction_id: 'private-inquiry', status: 'qualified', authority: 'crm', confirmed_at: '2026-10-08T00:00:00Z' },
    ],
    social_metric_snapshots: [
      { id: 'baseline', tenant_id: 'tenant-a', platform: 'tiktok', account_id: 'tt-1', captured_at: '2026-10-04T02:00:00Z', value_kind: 'cumulative', metrics: { views: 100 } },
      { id: 'delta', tenant_id: 'tenant-a', platform: 'tiktok', account_id: 'tt-1', captured_at: '2026-10-06T02:00:00Z', value_kind: 'cumulative', metrics: { views: 140 } },
      { id: 'daily', tenant_id: 'tenant-a', platform: 'youtube', account_id: 'yt-1', captured_at: '2026-10-07T02:00:00Z', value_kind: 'daily', metrics: { views: 20 } },
      { id: 'private-metric', tenant_id: 'tenant-b', platform: 'youtube', account_id: 'private', captured_at: '2026-10-07T02:00:00Z', value_kind: 'daily', metrics: { views: 999 } },
    ],
  } satisfies Record<string, Record_[]>;
}

test('weekly overview has one scoped, fully paginated contract for metrics and drilldowns', async () => {
  const range = mobileWorkbenchWeekRange(new Date('2026-10-10T03:00:00Z'), '2026-10-05');
  const result = await buildMobileWorkbenchOverview(mockStore(fixtures()), 'tenant-a', range);
  assert.equal(result.range.startsAt, '2026-10-04T16:00:00.000Z');
  assert.equal(result.range.endsAt, '2026-10-11T15:59:59.999Z');
  assert.equal(result.metrics.tasks.value, 206, 'all pages are counted while a spanning goal contributes only tasks created this week');
  assert.equal(result.metrics.completed.value, 3);
  assert.equal(result.taskDrilldown.total, result.metrics.tasks.value);
  assert.equal(result.taskDrilldown.items.filter(item => item.status === 'succeeded').length, result.metrics.completed.value);
  assert.equal(result.taskDrilldown.items.some(item => item.id === 'long-goal-history'), false);
  assert.equal(result.metrics.publishedVideos.value, 1);
  assert.equal(result.metrics.exposure.value, 60);
  assert.equal(result.metrics.qualifiedInquiries.value, 1);
  assert.equal(result.inquiryDrilldown.total, result.metrics.qualifiedInquiries.value);
  assert.deepEqual(result.inquiryDrilldown.items.map(item => item.id), ['inquiry-qualified']);
  assert.equal(result.inquiryDrilldown.items[0].sourceStatus, 'unknown');
  assert.deepEqual(result.contentSchedule.items.map(item => item.id), ['scheduled', 'published']);
  assert.deepEqual(result.contentSchedule.items.find(item => item.id === 'published') && { taskId: result.contentSchedule.items.find(item => item.id === 'published')!.taskId, contentId: result.contentSchedule.items.find(item => item.id === 'published')!.contentId }, { taskId: 'task-000', contentId: 'content-1' });
  assert.equal(result.agents.items.find(item => item.role === 'customer')?.currentTask?.id, 'open-old', 'agent coverage includes tenant open work outside the selected week');
  assert.ok(result.agents.items.every(item => item.updatedAt === null || item.updatedAt.includes('2026-')));
  assert.doesNotMatch(JSON.stringify(result), /private|secret|tenant-b/);
});

test('missing sources are unavailable, never fabricated zero, and HTTP scope comes from auth locals', async () => {
  const seed = fixtures(); const store = mockStore(seed, new Set(['social_metric_snapshots', 'social_sales_qualifications']));
  const app = express();
  app.use((req, res, next) => { if (!req.headers.authorization) { res.sendStatus(401); return; } res.locals.tenantId = 'tenant-a'; res.locals.userId = 'user-a'; next(); });
  app.use('/mobile', createMobileWorkbenchOverviewRouter(store));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/mobile/overview?weekStart=2026-10-05`)).status, 401);
    assert.equal((await fetch(`${base}/mobile/overview?weekStart=2026-10-06`, { headers: { authorization: 'test' } })).status, 400);
    const response = await fetch(`${base}/mobile/overview?weekStart=2026-10-05&tenantId=tenant-b`, { headers: { authorization: 'test' } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const body = await response.json() as any;
    assert.deepEqual(body.metrics.exposure, { value: null, availability: 'unavailable', source: 'social_metric_snapshots.metrics.views', range: body.range, note: '缺少足够的日值或累计快照，不能把缺失曝光显示为 0' });
    assert.equal(body.metrics.qualifiedInquiries.value, null);
    assert.equal(body.inquiryDrilldown.availability, 'unavailable');
    assert.deepEqual(body.inquiryDrilldown.items, []);
    assert.equal(body.metrics.tasks.value, 206, 'one failed source does not erase independent facts');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
