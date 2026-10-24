import assert from 'node:assert/strict';
import test from 'node:test';
import type { TrendVideo } from '../../lib/inspirationTypes';
import { inspirationDiscoveryCategory, newestCrawledFirst } from './inspirationDiscoveryCategory';
import { isDisplayableForFormat } from './inspirationAnalysisProjection';
import { readInspirationInventory, pageInspirationResults } from './inspirationResultPaging';

const video = (id: string, fields: Partial<TrendVideo> = {}): TrendVideo => ({
  id, title: id, platform: 'tiktok', sourceUrl: `https://www.tiktok.com/@factory/video/${id}`,
  contentFormat: 'video', thumbnail: '/preview.svg', duration: 15, tags: [], views: '100', trend: 'stable', ...fields,
});

test('benchmark category requires homepage collection provenance, not a display name or B2B label', () => {
  assert.equal(inspirationDiscoveryCategory(video('1', { aiAnalysis: {
    crawlRule: '对标账号主页', sourceAccount: 'https://www.tiktok.com/@factory', discoveryBusinessModel: 'b2b',
  } })), 'benchmark');
  assert.equal(inspirationDiscoveryCategory(video('2', { contentFormat: 'image', aiAnalysis: {
    crawlRule: '对标账号主页', sourceAccountUrl: 'https://www.instagram.com/factory/',
  } })), 'benchmark');
  assert.equal(inspirationDiscoveryCategory(video('3', { aiAnalysis: {
    crawlRule: '关键词检索', sourceAccount: 'https://www.tiktok.com/@factory', discoveryBusinessModel: 'b2b',
  } })), 'b2b');
  assert.equal(inspirationDiscoveryCategory(video('4', { aiAnalysis: { crawlRule: '对标账号主页', sourceAccount: '工厂昵称' } })), null);
});

test('B2B category has no industry/product restriction; generic material requires non-B2B evidence', () => {
  for (const industry of ['美妆', '机械', '包装', '电子']) {
    assert.equal(inspirationDiscoveryCategory(video(industry, { title: industry, aiAnalysis: { discoveryBusinessModel: 'b2b' } })), 'b2b');
  }
  assert.equal(inspirationDiscoveryCategory(video('达人', { aiAnalysis: { discoveryBusinessModel: 'd2c' } })), 'industry');
  assert.equal(inspirationDiscoveryCategory(video('unknown')), null);
  assert.equal(inspirationDiscoveryCategory(video('mixed', { aiAnalysis: { discoveryBusinessModel: 'mixed' } })), null);
});

test('all formats merge complete existing API pages, then sort by crawl time before pagination', async () => {
  const source = {
    video: Array.from({ length: 101 }, (_, i) => video(`v-${i}`, { crawledAt: '2026-10-23T01:00:00Z', views: '99999' })),
    image: Array.from({ length: 102 }, (_, i) => video(`i-${i}`, { contentFormat: 'image', crawledAt: '2026-10-24T01:00:00Z', views: '1' })),
  };
  const calls: string[] = [];
  const result = await readInspirationInventory(async (format, page) => {
    calls.push(`${format}:${page}`);
    return { items: source[format].slice((page - 1) * 100, page * 100), totalItems: source[format].length };
  }, 'all', 1, true, item => item.id, () => true);
  assert.deepEqual(calls.sort(), ['image:1', 'image:2', 'video:1', 'video:2']);
  assert.equal(result.totalItems, 203);
  const sorted = result.items.filter(item => isDisplayableForFormat(item, 'all')).sort(newestCrawledFirst);
  assert.equal(sorted.length, 203);
  assert.equal(pageInspirationResults(sorted, 1, 100).items.every(item => item.contentFormat === 'image'), true);
  assert.equal(pageInspirationResults(sorted, 3, 100).items.length, 3);
  assert.equal(isDisplayableForFormat(video('v'), 'image'), false);
  assert.equal(isDisplayableForFormat(video('i', { contentFormat: 'image' }), 'video'), false);
  assert.equal(newestCrawledFirst(video('missing'), video('dated', { crawledAt: '2026-10-23' })) > 0, true);
});
