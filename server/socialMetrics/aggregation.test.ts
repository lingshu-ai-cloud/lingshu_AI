import assert from 'node:assert/strict';
import { buildDailyTotals, buildMetricTrend, currentMetricTotal, normalizeMetricValues, type MetricSnapshot } from './aggregation.js';

const snapshots: MetricSnapshot[] = [
  { platform: 'tiktok', accountId: 'a', contentId: 'v1', capturedAt: '2026-07-30T08:00:00Z', metrics: { views: 100 } },
  { platform: 'tiktok', accountId: 'a', contentId: 'v1', capturedAt: '2026-08-01T08:00:00Z', metrics: { views: 150 } },
  { platform: 'tiktok', accountId: 'a', contentId: 'v1', capturedAt: '2026-08-08T08:00:00Z', metrics: { views: 250 } },
  { platform: 'tiktok', accountId: 'a', contentId: 'v1', capturedAt: '2026-08-15T08:00:00Z', metrics: { views: 450 } },
  // Account total must not be added on top of content totals.
  { platform: 'tiktok', accountId: 'a', capturedAt: '2026-08-15T09:00:00Z', metrics: { views: 9999, followers: 20 } },
];

assert.deepEqual(buildDailyTotals(snapshots, 'views').at(-1), { date: '2026-08-15', value: 200 });
assert.equal(buildDailyTotals(snapshots, 'followers').length, 0, 'first cumulative observation is only a baseline');
const trend = buildMetricTrend(snapshots, 'views', 7, new Date('2026-08-15T12:00:00Z'));
assert.equal(trend.available, true);
assert.equal(trend.current, 200);
assert.equal(trend.previous, 100);
assert.equal(trend.changeRate, 1);
assert.equal(buildMetricTrend(snapshots.slice(-1), 'followers', 7, new Date('2026-08-15T12:00:00Z')).reason, 'no_data');
assert.deepEqual(normalizeMetricValues({ views: '12', impossible: 99, likes: -1 }), { views: 12 });

const mixedGranularity: MetricSnapshot[] = [
  { platform: 'tiktok', accountId: 'tk', contentId: 'video', capturedAt: '2026-08-15T08:00:00Z', metrics: { views: 120 } },
  { platform: 'tiktok', accountId: 'tk', capturedAt: '2026-08-15T09:00:00Z', metrics: { views: 999 } },
  { platform: 'youtube', accountId: 'yt', capturedAt: '2026-08-15T08:00:00Z', metrics: { views: 300 } },
];
assert.equal(currentMetricTotal(mixedGranularity, 'views'), 420, 'latest totals retain account-only YouTube metrics');

const mixedValueKinds: MetricSnapshot[] = [
  { platform: 'tiktok', accountId: 'tk', contentId: 'v1', capturedAt: '2026-08-07T08:00:00Z', valueKind: 'cumulative', metrics: { views: 100 } },
  { platform: 'tiktok', accountId: 'tk', contentId: 'v1', capturedAt: '2026-08-08T08:00:00Z', valueKind: 'cumulative', metrics: { views: 140 } },
  { platform: 'youtube', accountId: 'yt', capturedAt: '2026-08-08T09:00:00Z', valueKind: 'daily', metrics: { views: 25 } },
  { platform: 'youtube', accountId: 'yt', capturedAt: '2026-08-15T09:00:00Z', valueKind: 'daily', metrics: { views: 35 } },
  { platform: 'tiktok', accountId: 'tk', contentId: 'v1', capturedAt: '2026-08-15T08:00:00Z', valueKind: 'cumulative', metrics: { views: 200 } },
];
assert.deepEqual(buildDailyTotals(mixedValueKinds, 'views'), [
  { date: '2026-08-08', value: 65 },
  { date: '2026-08-15', value: 95 },
]);
assert.deepEqual(buildMetricTrend(mixedValueKinds, 'views', 7, new Date('2026-08-15T12:00:00Z')), {
  key: 'views', available: true, current: 95, previous: 65, change: 30, changeRate: 30 / 65,
});
console.log('social metric aggregation passed');
