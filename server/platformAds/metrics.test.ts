import assert from 'node:assert/strict';
import { aggregateAdMetrics, aggregateMetaResources, validateMetaMetricRows } from './metrics.js';
const empty = aggregateAdMetrics([], '提升有效视频观看');
assert.equal(empty.spend, null);
assert.equal(empty.results, null);
const partial = aggregateAdMetrics([{ spend: '5', impressions: '100', clicks: '20' }], '提升有效视频观看');
assert.equal(partial.results, null, 'clicks cannot substitute for video views');
assert.equal(partial.costPerResult, null);
const video = aggregateAdMetrics([{ spend: '5', impressions: '100', clicks: '20', video_thruplay_watched_actions: [{ action_type: 'video_view', value: '50' }] }], '提升有效视频观看');
assert.equal(video.results, 50);
assert.equal(video.costPerResult, 0.1);
const noConversionMapping = aggregateAdMetrics([{ spend: '5', clicks: '20' }], '获取线索或转化');
assert.equal(noConversionMapping.results, null);
console.log('ad metric provenance and missing-data tests passed');

const validRow = { account_id: '123', campaign_id: '456', account_currency: 'CNY', date_start: '2026-10-27', date_stop: '2026-10-27', spend: '3.23' };
assert.doesNotThrow(() => validateMetaMetricRows([validRow], '123', '456', 'CNY', '2026-10-25', '2026-10-31'));
for (const row of [{ ...validRow, account_id: '999' }, { ...validRow, campaign_id: '999' }, { ...validRow, campaign_id: undefined }, { ...validRow, account_currency: 'USD' }, { ...validRow, date_start: '2026-10-32', date_stop: '2026-10-32' }, { ...validRow, date_stop: '2026-10-28' }]) {
  assert.throws(() => validateMetaMetricRows([row], '123', '456', 'CNY', '2026-10-25', '2026-10-31'));
}
assert.throws(() => validateMetaMetricRows([validRow, validRow], '123', '456', 'CNY', '2026-10-25', '2026-10-31'));
for (const invalid of [true, false, ' ', {}, -1, 'NaN']) assert.equal(aggregateAdMetrics([{ spend: invalid as any }], '提升有效视频观看').spend, null);
const day = { date_start: '2026-10-27', spend: '3.23', impressions: '100', clicks: '4' };
const otherDay = { date_start: '2026-10-28', spend: '2', impressions: '50', clicks: '2' };
const combined = aggregateMetaResources([[day, otherDay], [{ ...day, spend: '6.77' }]], '提升有效视频观看');
assert.equal(combined.spend, 12);
assert.equal(combined.daily.length, 2);
assert.equal(combined.daily[0].spend, 10);
assert.equal(combined.daily[1].spend, null, 'a missing resource-day cannot be inferred as zero');
assert.equal(aggregateMetaResources([[day], []], '提升有效视频观看').spend, null, 'missing resource report cannot be omitted from total');
