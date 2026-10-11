import assert from 'node:assert/strict';
import { buildApifyTikTokInput } from './videos.js';

assert.deepEqual(buildApifyTikTokInput('https://www.tiktok.com/@demo/video/1234567890123456789', 5).postURLs,
  ['https://www.tiktok.com/@demo/video/1234567890123456789']);
assert.deepEqual(buildApifyTikTokInput('https://www.tiktok.com/@demo', 5).profiles, ['demo']);
assert.deepEqual(buildApifyTikTokInput('#skincare', 5).hashtags, ['skincare']);
assert.deepEqual(buildApifyTikTokInput('skincare', 5).hashtags, ['skincare']);

const search = buildApifyTikTokInput('Face Cleanser Supplier', 12, '2026-10-04', '2026-10-11');
assert.deepEqual(search.searchQueries, ['Face Cleanser Supplier']);
assert.equal(search.searchSection, '/video');
assert.equal(search.videoSearchDateFilter, 'PAST_WEEK');
assert.equal(search.oldestPostDateUnified, '2026-10-04');
assert.equal(search.newestPostDate, '2026-10-11');
assert.equal('hashtags' in search, false);
assert.equal('oldestPostDate' in search, false);

console.log('Apify TikTok input tests passed');
