import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const schedulerSource = readFileSync(new URL('./scheduler.ts', import.meta.url), 'utf8');
const start = schedulerSource.indexOf('async function executeCompetitorAccountCrawl');
const end = schedulerSource.indexOf('/** Worker 状态变化后', start);
const competitorCrawl = schedulerSource.slice(start, end);
const videosSource = readFileSync(new URL('./videos.ts', import.meta.url), 'utf8');

test('scheduled benchmark collection imports both high-performing videos and image posts with captions', () => {
  assert.ok(start >= 0 && end > start, '对标账号定时采集器必须存在');
  assert.match(competitorCrawl, /crawlVideosForTenant\(\{/);
  assert.match(competitorCrawl, /crawlImagePostsForTenant\(\{/);
  assert.match(competitorCrawl, /deferImageAnalysis: true/);
  assert.match(competitorCrawl, /lastCrawlMode: 'mixed'/);
  assert.match(competitorCrawl, /含原帖配文/);
  assert.match(videosSource, /sort\(\(left, right\) => imagePostHeatValue\(right\) - imagePostHeatValue\(left\)\)/);
  assert.match(videosSource, /caption: item\.caption \|\| item\.title/);
});
