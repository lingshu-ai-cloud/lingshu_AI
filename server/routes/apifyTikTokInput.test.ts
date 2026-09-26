import assert from 'node:assert/strict';
import { buildApifyTikTokInput } from './videos.js';

const search = buildApifyTikTokInput('nail drill', 3);
assert.deepEqual(search.searchQueries, ['nail drill']);
assert.equal(search.searchSection, '/video');
assert.equal(search.hashtags, undefined);
assert.equal(search.shouldDownloadVideos, false);

const hashtag = buildApifyTikTokInput('#naildrill', 3);
assert.deepEqual(hashtag.hashtags, ['naildrill']);
assert.equal(hashtag.searchQueries, undefined);

console.log('Apify TikTok search and hashtag input contract tests passed');
