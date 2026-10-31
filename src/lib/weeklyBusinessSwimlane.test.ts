import assert from 'node:assert/strict';
import test from 'node:test';
import type { BusinessWorkItem } from './businessWorkProjection';
import type { DigitalEmployeeOverview } from './digitalEmployees';
import { operatingWeekDays, projectWeeklyBusinessSwimlane } from './weeklyBusinessSwimlane';

test('the operating week follows its persisted first day, not Monday', () => {
  assert.deepEqual(operatingWeekDays('2026-10-29'), [
    '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01',
    '2026-11-02', '2026-11-03', '2026-11-04',
  ]);
});

test('a blocked image does not turn the whole week into an unstarted run', () => {
  const data = {
    goal: { id: 'goal-1', startsAt: '2026-10-29', endsAt: '2026-11-04', updatedAt: '2026-10-29T08:00:00Z', promotionPlans: [{ contentId: 'video-1', budgetCny: 100 }] },
    run: { id: 'run-1', status: 'running' },
    plan: { businessPackage: { mixedContentSlots: [
      { slotId: 'image-1', productionRole: 'original' }, { slotId: 'video-1', productionRole: 'original' },
      { slotId: 'adaptation-1', productionRole: 'adaptation' },
    ] } },
    contentQueue: { items: [
      { id: 'image-1', origin: 'weekly_plan', title: '第一张图', status: 'blocked', reason: '缺少产品图片', plannedPublishDate: '2026-10-30', updatedAt: '2026-10-30T08:00:00Z', socialContentTaskId: 'content-1' },
      { id: 'video-1', origin: 'weekly_plan', title: '第一条视频', status: 'producing', reason: '', plannedPublishDate: '2026-10-31', updatedAt: '2026-10-30T09:00:00Z', socialContentTaskId: 'content-2' },
    ] },
    review: null,
  } as unknown as DigitalEmployeeOverview;
  const projection = projectWeeklyBusinessSwimlane(data, [], []);
  assert.ok(projection);
  assert.equal(projection.started, true);
  assert.equal(projection.title, '本周运营中 · 1 项待处理');
  assert.equal(projection.originalCount, 2);
  assert.equal(projection.publicationCount, 3);
  assert.equal(projection.lanes[0]?.status, '1 条需处理');
  assert.equal(projection.lanes[1]?.current, '1 项拟投放，尚未取得对应投流计划回执');
  assert.equal(projection.lanes[4]?.nodes[0]?.date, '2026-11-01');
});

test('only an ad plan explicitly linked to this goal appears in its traffic lane', () => {
  const data = { goal: { id: 'goal-1', startsAt: '2026-10-29', updatedAt: '' }, run: null, plan: null,
    contentQueue: { items: [] }, review: null } as unknown as DigitalEmployeeOverview;
  const ads = [
    { kind: 'traffic', id: 'ad-1', title: '其他周计划', status: '运行中', needsAction: false, next: '', updatedAt: '', task: { sourceContext: { goalId: 'goal-2' } } },
    { kind: 'traffic', id: 'ad-2', title: '本周计划', status: '待核对', needsAction: true, next: '核对平台回执', updatedAt: '2026-10-30T09:00:00Z', task: { sourceContext: { goalId: 'goal-1' } } },
  ] as unknown as BusinessWorkItem[];
  const projection = projectWeeklyBusinessSwimlane(data, ads, []);
  assert.equal(projection?.lanes[1]?.current, '1 项本周关联计划；状态以原投流回执为准');
  assert.equal(projection?.lanes[1]?.needsAttention, true);
  assert.equal(projection?.attentionCount, 1);
});

test('the review window follows a persisted account schedule instead of a visual default', () => {
  const data = { goal: { id: 'goal-1', startsAt: '2026-10-29', updatedAt: '' }, config: { reviewSchedule: '周五 17:30（北京时间）' },
    run: null, plan: null, contentQueue: { items: [] }, review: null } as unknown as DigitalEmployeeOverview;
  const projection = projectWeeklyBusinessSwimlane(data, [], []);
  assert.equal(projection?.lanes[4]?.nodes[0]?.date, '2026-10-30');
  assert.equal(projection?.lanes[4]?.nodes[0]?.label, '17:30 周报');
});
