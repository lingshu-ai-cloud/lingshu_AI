import test from 'node:test';
import assert from 'node:assert/strict';
import { basfArticleLinks, discoverPublisherNews } from './publisherNewsDiscovery.js';

test('official directory discovery follows actual same-publisher article links, not injected URLs or listing pages', () => {
  const article = '/tw/zh/media/news-releases/asia-pacific/2026/10/apac-26-116';
  const html = [article, article, '/tw/zh/media/news-releases', 'https://evil.example/2026/10/fake',
    'https://www.basf.com.evil.example/tw/zh/media/news-releases/asia-pacific/2026/10/fake'].map(href => `<a href="${href}">More</a>`).join('');
  assert.deepEqual(basfArticleLinks(html).map(source => source.uri), [`https://www.basf.com${article}`]);
});
test('directory access is limited to explicit relevant company queries and assigned source scope', async () => {
  let reads = 0;
  const fetcher: typeof fetch = async () => { reads++; return new Response('<a href="/tw/zh/media/news-releases/asia-pacific/2026/10/apac-26-116">More</a>'); };
  assert.equal((await discoverPublisherNews('全球美妆原料 BASF', { domains: ['basf.com'], fetcher })).length, 1);
  assert.deepEqual(await discoverPublisherNews('TikTok 美妆社交资讯', { fetcher }), []);
  assert.deepEqual(await discoverPublisherNews('全球美妆原料 BASF', { domains: ['fda.gov'], fetcher }), []);
  assert.equal(reads, 1);
});
