import assert from 'node:assert/strict';
import test from 'node:test';
import type { SocialDiscoverySupplyItem } from '../../../shared/contracts/socialContentWorkflow';
import { isDisplayableForFormat } from './inspirationAnalysisProjection';
import { matchesInspirationCrawlRange, pageInspirationResults, readAllInspirationPages } from './inspirationResultPaging';
import { supplyItemsToVideos } from './inspirationVideoProjection';

test('mixed scored supply retains image matches beyond page 1 and paginates only after format/date/favorite filters', async () => {
  const source = Array.from({ length: 307 }, (_, i) => ({
    candidateId: `record-${i}`, candidateType: 'video', platform: 'instagram', title: `参考${i}`,
    sourceUrl: `https://www.instagram.com/p/${i}/`, thumbnailUrl: '/image.png',
    score: { overall: 100 - i / 10, scoredAt: '2026-10-24T03:00:00Z' },
    raw: { crawledAt: i === 306 ? '2026-10-01T00:00:00Z' : '2026-10-24T03:00:00Z',
      aiAnalysis: JSON.stringify({ contentFormat: i < 101 ? 'video' : 'image', views: String(i) }) },
  })) as unknown as SocialDiscoverySupplyItem[];
  const calls: number[] = [];
  const all = await readAllInspirationPages(async page => {
    calls.push(page);
    return { items: source.slice((page - 1) * 100, page * 100), totalItems: source.length };
  }, item => item.candidateId);
  assert.deepEqual(calls, [1, 2, 3, 4]);
  const videos = supplyItemsToVideos(all);
  assert.deepEqual(videos.map(v => v.recordId), source.map(item => item.candidateId), 'public views must not override server score order');
  const images = videos.filter(video => isDisplayableForFormat(video, 'image')
    && matchesInspirationCrawlRange(video, '7d', Date.parse('2026-10-24T06:00:00Z')));
  const last = pageInspirationResults(images, 3, 100);
  assert.equal(last.totalItems, 205);
  assert.equal(last.totalPages, 3);
  assert.equal(last.items.length, 5);
  assert.equal(last.items[4].recordId, 'record-305');
  const favoriteUrls = new Set([source[305].sourceUrl]);
  const favorites = pageInspirationResults(images.filter(video => favoriteUrls.has(video.sourceUrl!)), 3, 100);
  assert.equal(favorites.page, 1, 'shrinking the result clamps an obsolete page');
  assert.deepEqual(favorites.items.map(item => item.recordId), ['record-305']);
});

test('crawl-today uses Beijing midnight, not the browser timezone', () => {
  const now = Date.parse('2026-10-24T01:00:00Z');
  const video = supplyItemsToVideos([{ candidateId: 'i', platform: 'tiktok', title: 'i', sourceUrl: 'https://tiktok.com/i',
    score: { scoredAt: '2026-10-23T16:00:00Z' }, raw: { crawledAt: '2026-10-23T16:00:00Z' } } as unknown as SocialDiscoverySupplyItem])[0];
  assert.equal(matchesInspirationCrawlRange(video, 'today', now), true);
  assert.equal(matchesInspirationCrawlRange({ ...video, crawledAt: '2026-10-23T15:59:59Z' }, 'today', now), false);
  assert.equal(matchesInspirationCrawlRange({ ...video, crawledAt: undefined }, '30d', now), false);
});

test('incomplete, failed, changed or superseded page reads never publish a partial successful list', async () => {
  await assert.rejects(readAllInspirationPages(async page => ({ items: page === 1 ? ['a'] : [], totalItems: 2 }), v => v), /不完整/);
  await assert.rejects(readAllInspirationPages(async page => {
    if (page === 2) throw Error('HTTP 503');
    return { items: ['a'], totalItems: 2 };
  }, v => v), /503/);
  await assert.rejects(readAllInspirationPages(async page => ({ items: ['a'], totalItems: page === 1 ? 2 : 3 }), v => v), /库存已变化/);
  await assert.rejects(readAllInspirationPages(async () => ({ items: ['a'], totalItems: 1 }), v => v, () => false), /筛选已更新/);
});
