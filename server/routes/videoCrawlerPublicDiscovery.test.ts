import assert from 'node:assert/strict';
import test from 'node:test';
import { crawlYouTubePublicSearch, fetchPublicText, searchPublicVideoUrlsByQuery } from './videoCrawlerPublicDiscovery.js';

test('YouTube public search uses eligible yt-dlp shorts without making an HTML request', async () => {
  let htmlRequests = 0;
  const items = await crawlYouTubePublicSearch({
    keyword: 'factory', limit: 1, dateFrom: '2026-10-20', dateTo: '2026-10-23',
    crawlFlatSearch: async (_platform, url, _keyword, limit, _from, _to, shorts) => {
      assert.match(url, /sp=EgIYAQ%253D%253D/);
      assert.equal(limit, 3);
      assert.equal(shorts, true);
      return [
        { platform: 'youtube', title: 'Too old', sourceUrl: 'https://www.youtube.com/shorts/Old00000001', thumbnailUrl: '', duration: 10, views: '', tags: [], uploadedAt: '2026-10-01', youtubeShort: true },
        { platform: 'youtube', title: 'Current', sourceUrl: 'https://www.youtube.com/shorts/New00000001', thumbnailUrl: '', duration: 12, views: '', tags: [], uploadedAt: '2026-10-21', youtubeShort: true },
      ];
    },
    fetchPage: async () => { htmlRequests += 1; throw new Error('HTML must not be fetched'); },
  });
  assert.deepEqual(items.map(item => item.title), ['Current']);
  assert.equal(htmlRequests, 0);
});

test('YouTube HTML fallback preserves short identity, deduplication and date evidence', async () => {
  const renderer = {
    videoId: 'AbCdEfGh123', title: { simpleText: 'Factory demo' }, lengthText: { simpleText: '0:18' },
    viewCountText: { simpleText: '1,234 views' }, thumbnail: { thumbnails: [{ url: 'https://example.test/thumb.jpg', width: 400 }] },
  };
  const html = `<script>var ytInitialData = ${JSON.stringify({ rows: [{ videoRenderer: renderer }, { videoRenderer: renderer }] })};</script>`;
  const items = await crawlYouTubePublicSearch({
    keyword: '#factory supplier', limit: 3, dateFrom: '2026-10-04', dateTo: '2026-10-11',
    crawlFlatSearch: async () => { throw new Error('yt-dlp unavailable'); },
    fetchPage: async (url) => {
      assert.match(String(url), /sp=EgIIAw%253D%253D/);
      return new Response(html, { status: 200 });
    },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0]?.sourceUrl, 'https://www.youtube.com/shorts/AbCdEfGh123');
  assert.equal(items[0]?.duration, 18);
  assert.equal(items[0]?.dateEvidence, 'youtube-upload-filter');
  assert.deepEqual(items[0]?.tags, ['factory', 'supplier']);
});

test('public search failures retain both yt-dlp and HTML evidence', async () => {
  await assert.rejects(crawlYouTubePublicSearch({
    keyword: 'factory', limit: 1,
    crawlFlatSearch: async () => { throw new Error('flat-list unavailable'); },
    fetchPage: async () => new Response('', { status: 503 }),
  }), /flat-list unavailable；HTML search HTTP 503/);
  await assert.rejects(fetchPublicText('https://example.test', 1000, async () => new Response('', { status: 429 })), /HTTP 429/);
});

test('Bing public URL extraction keeps only canonical platform video links', async () => {
  const urls = await searchPublicVideoUrlsByQuery('tiktok', 'factory', 3, async (url, timeoutMs) => {
    assert.match(url, /www\.bing\.com\/search\?format=rss&q=factory/);
    assert.equal(timeoutMs, 20_000);
    return '<item><link>https://www.tiktok.com/@maker/video/1234567890?utm_source=feed</link></item>'
      + '<item><link>https://evil.example/video/1234567890</link></item>'
      + '<item><link>https://www.tiktok.com/@maker/video/1234567890?utm_source=feed</link></item>';
  });
  assert.deepEqual(urls, ['https://www.tiktok.com/@maker/video/1234567890']);
});
