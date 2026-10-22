import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const schedulerSource = readFileSync(new URL('./scheduler.ts', import.meta.url), 'utf8');
const crawlSource = readFileSync(new URL('./schedulerCrawlTasks.ts', import.meta.url), 'utf8');
const start = crawlSource.indexOf('export async function executeCompetitorAccountCrawl');
const competitorCrawl = crawlSource.slice(start);
const videosSource = readFileSync(new URL('./videos.ts', import.meta.url), 'utf8');

test('scheduled benchmark collection imports videos and scoped image posts with captions', () => {
  assert.ok(start >= 0, '对标账号定时采集器必须存在');
  assert.match(schedulerSource, /return executeCompetitorAccountCrawl\(task\)/, '调度路由必须继续执行采集器');
  assert.match(competitorCrawl, /crawlVideosForTenant\(\{/);
  assert.match(competitorCrawl, /crawlImagePostsForTenant\(\{/);
  assert.match(competitorCrawl, /deferImageAnalysis: true/);
  assert.match(competitorCrawl, /lastCrawlMode: 'mixed'/);
  assert.match(competitorCrawl, /含原帖配文/);
  assert.match(videosSource, /\.filter\(item => item\.platform === input\.platform && isPlatformUrl\(item\.sourceUrl, input\.platform\)\)/);
  assert.match(videosSource, /if \(seen\.has\(item\.sourceUrl\)\) return false;/);
  assert.match(videosSource, /caption: item\.caption \|\| item\.title/);
});
