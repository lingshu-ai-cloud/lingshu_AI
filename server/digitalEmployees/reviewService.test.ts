import assert from 'node:assert/strict';
import { measureBusinessOutcome } from './reviewService.js';

const goal = {
  title: '测试', objective: '提升播放', metric: 'views', baseline: 100, target: 180, unit: '次',
  startsAt: '2026-08-01', endsAt: '2026-08-07', scope: 'US', budgetLimit: 100, constraints: [],
};

const measured = measureBusinessOutcome({
  goal,
  now: new Date('2026-08-08T00:00:00.000Z'),
  approvals: [], posts: [],
  snapshots: [
    { id: 'm1', platform: 'tiktok', accountId: 'a1', contentId: 'v1', capturedAt: '2026-07-31T10:00:00.000Z', metrics: { views: 100 } },
    { id: 'm2', platform: 'tiktok', accountId: 'a1', contentId: 'v1', capturedAt: '2026-08-03T10:00:00.000Z', metrics: { views: 140 } },
    { id: 'm3', platform: 'tiktok', accountId: 'a1', contentId: 'v1', capturedAt: '2026-08-07T10:00:00.000Z', metrics: { views: 185 } },
  ],
});
assert.equal(measured.measuredIncrement, 85);
assert.equal(measured.observedValue, 185);
assert.equal(measured.status, 'achieved');
assert.equal(measured.dataQuality, 'verified');

const noEvidence = measureBusinessOutcome({ goal, snapshots: [], approvals: [], posts: [], now: new Date('2026-08-08T00:00:00.000Z') });
assert.equal(noEvidence.status, 'awaiting_measurement');
assert.equal(noEvidence.observedValue, null);

const workflowMetric = measureBusinessOutcome({
  goal: { ...goal, metric: 'approved_content_packages', baseline: 0, target: 2 },
  snapshots: [], posts: [], now: new Date('2026-08-03T00:00:00.000Z'),
  approvals: [{ id: 'a1', status: 'approved' }, { id: 'a2', status: 'rejected' }],
});
assert.equal(workflowMetric.status, 'in_progress');
assert.equal(workflowMetric.observedValue, 1);

const fakePublish = measureBusinessOutcome({
  goal: { ...goal, metric: 'published_posts', baseline: 0, target: 1 }, snapshots: [], approvals: [], now: new Date('2026-08-08T00:00:00.000Z'),
  posts: [{ id: 'p1', published_at: '2026-08-05T00:00:00.000Z', platform_post_id: '', stats: { status: 'scheduled' } }],
});
assert.equal(fakePublish.status, 'not_achieved');
assert.equal(fakePublish.observedValue, 0);

const unsupported = measureBusinessOutcome({ goal: { ...goal, metric: 'brand_magic' }, snapshots: [], approvals: [], posts: [] });
assert.equal(unsupported.status, 'unsupported_metric');

console.log('digital employee evidence-backed review tests passed');
