import assert from 'node:assert/strict';
import test from 'node:test';
import { crawlInspirationImages } from './inspirationImageCrawl.js';

test('image crawl calls the existing tenant-scoped image-post endpoint', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const result = await crawlInspirationImages({ platform: 'instagram', keyword: ' cosmetic packaging ', limit: 12 }, {
    headers: { Authorization: 'Bearer local' },
    fetcher: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({
        imported: 1, skipped: 0, returnedExisting: 0, requested: 12, total: 1,
        message: '图文采集完成', items: [{ id: 'image-1', platform: 'instagram' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  const request = requests[0];
  assert.equal(request?.url, '/api/overseas/videos/crawl-image-posts');
  assert.equal(request?.init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    platform: 'instagram', keyword: 'cosmetic packaging', limit: 12,
  });
  assert.equal((request?.init?.headers as Record<string, string>).Authorization, 'Bearer local');
  assert.equal(result.items[0]?.id, 'image-1');
});

test('image crawl rejects empty keywords and preserves backend errors', async () => {
  await assert.rejects(() => crawlInspirationImages({ platform: 'facebook', keyword: ' ', limit: 6 }), /请输入采集关键词/);
  await assert.rejects(() => crawlInspirationImages({ platform: 'tiktok', keyword: 'factory', limit: 6 }, {
    fetcher: async () => new Response(JSON.stringify({ error: '采集服务额度不足' }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    }),
  }), /采集服务额度不足/);
});
