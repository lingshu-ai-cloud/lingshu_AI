import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { normalizeCrawlerConfig, resolveCrawlerPlatform } from './schedulerCrawlTasks.js';

test('scheduler crawl configuration preserves platform and bounded request limits', () => {
  assert.equal(resolveCrawlerPlatform('TikTok, YouTube'), 'tiktok');
  assert.equal(resolveCrawlerPlatform('unknown'), 'youtube');
  const config = normalizeCrawlerConfig({ platforms: 'Instagram', keywords: '美容, 护肤', limit: '999' });
  assert.equal(config.platforms, 'instagram');
  assert.equal(config.limit, '50');
  assert.equal(config.keywordSource, 'business_profile');
  assert.ok(config.keywords.includes('美容'));
});

test('scheduler routes retain the extracted crawl dispatch and configuration boundary', () => {
  const source = readFileSync(new URL('./scheduler.ts', import.meta.url), 'utf8');
  assert.match(source, /if \(task\.taskType === 'video_keyword_crawl'\) return executeVideoKeywordCrawl\(task\)/);
  assert.match(source, /if \(task\.taskType === 'image_post_crawl'\) return executeImagePostCrawl\(task\)/);
  assert.match(source, /if \(task\.taskType === 'competitor_account_crawl'\) return executeCompetitorAccountCrawl\(task\)/);
  assert.match(source, /normalizeCrawlerConfig\(\{ \.\.\.\(req\.body\.config \?\? \{\}\), tenantId \}, crawlerPlatform\)/);
});
