import assert from 'node:assert/strict';
import test from 'node:test';
import { competitorAccountCrawlState, readAllCompetitorAccountPages } from './competitorAccountState';

test('account page reads beyond 200 accounts instead of truncating its count', async () => {
  const pages: number[] = [];
  const rows = await readAllCompetitorAccountPages(async page => { pages.push(page); return { items: [page], totalPages: 3 }; });
  assert.deepEqual(rows, [1, 2, 3]);
  assert.deepEqual(pages, [1, 2, 3]);
  await assert.rejects(readAllCompetitorAccountPages(async () => ({ items: [], totalPages: 2 })), /分页不完整/);
});

test('worker receipts supply queued, failed and completed crawl status', () => {
  const job = { id: 'j', tenantId: 'a', createdAt: '2026-10-24T00:00:00Z', status: 'queued' };
  assert.equal(competitorAccountCrawlState({}, job).crawlStatus, 'running');
  assert.equal(competitorAccountCrawlState({}, { ...job, status: 'failed', error: 'worker offline' }).crawlError, 'worker offline');
  const done = competitorAccountCrawlState({ lastCrawlCount: 1 }, { ...job, status: 'done', resultJson: '{"imported":12}', finishedAt: '2026-10-24T01:00:00Z' });
  assert.equal(done.crawlStatus, 'completed'); assert.equal(done.lastCrawlCount, 12); assert.equal(done.lastCrawledAt, '2026-10-24T01:00:00Z');
  assert.equal(competitorAccountCrawlState({ lastCrawlCount: 3 }, { ...job, status: 'done', resultJson: 'null' }).lastCrawlCount, 3);
  assert.equal(competitorAccountCrawlState({ crawlStatus: 'running', crawlStartedAt: job.createdAt }, undefined, Date.parse('2026-10-24T01:00:00Z')).crawlStatus, 'failed');
});
