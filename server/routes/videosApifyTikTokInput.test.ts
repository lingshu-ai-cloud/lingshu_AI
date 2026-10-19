import assert from 'node:assert/strict';
import { apifyCandidateWindow, buildApifyFacebookAccountInput, buildApifyTikTokInput } from './videos.js';

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

assert.equal(buildApifyTikTokInput('skincare', apifyCandidateWindow(1, 'tiktok', true)).resultsPerPage, 1);
assert.equal(buildApifyTikTokInput('skincare', apifyCandidateWindow(1, 'tiktok', false)).resultsPerPage, 5);
assert.equal(buildApifyFacebookAccountInput('https://www.facebook.com/demo', 1, true).resultsLimit, 1);
assert.equal(buildApifyFacebookAccountInput('https://www.facebook.com/demo', 1, true).maxPosts, 1);
assert.equal(buildApifyFacebookAccountInput('https://www.facebook.com/demo', 1).resultsLimit, 10);

console.log('Apify TikTok input tests passed');
