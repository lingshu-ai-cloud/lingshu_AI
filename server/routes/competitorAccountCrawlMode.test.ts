import assert from 'node:assert/strict';
import {
  combineCompetitorCrawlResults,
  normalizeCompetitorCrawlMode,
} from './competitorAccounts.js';
import { shouldCreateTestTenantAnalysisJob } from './videos.js';

assert.equal(normalizeCompetitorCrawlMode('video'), 'video');
assert.equal(normalizeCompetitorCrawlMode('image'), 'image');
assert.equal(normalizeCompetitorCrawlMode('mixed'), 'mixed');
assert.equal(normalizeCompetitorCrawlMode('unexpected'), 'video');
assert.equal(shouldCreateTestTenantAnalysisJob({ downloadStatus: 'queued' }, false), true, 'a pre-marked row without an ops receipt must still create its job');
assert.equal(shouldCreateTestTenantAnalysisJob({ crawlerOpsTaskId: 'accepted-job' }, false), false, 'an accepted durable job must not be duplicated');

const base = {
  outcome: 'collected' as const,
  platform: 'facebook' as const,
  keyword: 'BASF',
  refreshed: 0,
  skipped: 0,
  skippedExisting: 0,
  requested: 3,
  source: 'test',
};

const combined = combineCompetitorCrawlResults('mixed', 'facebook', [
  {
    format: 'video',
    result: {
      ...base,
      imported: 1,
      returnedExisting: 0,
      total: 1,
      message: 'video',
      items: [{ id: 'video-1', sourceUrl: 'https://facebook.com/page/posts/shared' }],
    },
  },
  {
    format: 'image',
    result: {
      ...base,
      imported: 1,
      skipped: 1,
      skippedExisting: 1,
      returnedExisting: 1,
      total: 2,
      message: 'image',
      items: [
        { id: 'image-duplicate', sourceUrl: 'https://facebook.com/page/posts/shared' },
        { id: 'image-2', sourceUrl: 'https://facebook.com/page/posts/image-2' },
      ],
    },
  },
]);

assert.equal(combined.mode, 'mixed');
assert.equal(combined.imported, 2);
assert.equal(combined.returnedExisting, 1);
assert.equal(combined.items.length, 2, 'mixed response must deduplicate identical source posts');
assert.deepEqual(Object.keys(combined.byFormat).sort(), ['image', 'video']);
assert.match(combined.message, /原帖地址去重/);

console.log('competitor account crawl mode tests passed');
