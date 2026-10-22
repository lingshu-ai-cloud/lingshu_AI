import assert from 'node:assert/strict';
import test from 'node:test';
import type { TrendVideo } from '../../lib/inspirationTypes';
import { resolveInspirationReference } from './inspirationReferenceResolver';
import type { InspirationReferenceTarget } from './inspirationReferenceTarget';

const target: InspirationReferenceTarget = {
  referenceId: 'crawl-record-1', sourceUrl: 'https://example.test/post/1', title: 'Factory Product Review',
  platform: 'youtube', thumbnailUrl: '/frozen.jpg', duration: 15,
};
const loaded = { id: 'crawl-record-1', recordId: 'record-1', sourceUrl: target.sourceUrl, title: target.title, platform: 'youtube' } as TrendVideo;
const headers = { Authorization: 'Bearer test-only' };

test('already loaded exact reference opens without a second request', async () => {
  const result = await resolveInspirationReference({ target, loadedVideos: [loaded], headers, fetcher: async () => { throw Error('unexpected request'); } });
  assert.equal(result.source, 'record');
  assert.equal(result.video, loaded);
});

test('missing loaded reference uses one authenticated read by frozen record id', async () => {
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  const result = await resolveInspirationReference({ target, loadedVideos: [], headers, fetcher: async (url, init) => {
    requests.push({ url, headers: init.headers });
    return { ok: true, json: async () => ({ id: 'record-1', platform: 'youtube', title: target.title, sourceUrl: target.sourceUrl, duration: 15 }) };
  } });
  assert.equal(result.source, 'record');
  assert.equal(result.video.recordId, 'record-1');
  assert.deepEqual(requests, [{ url: '/api/overseas/videos/record-1', headers }]);
});

test('title search rejects unrelated candidates and keeps the frozen snapshot', async () => {
  const requests: string[] = [];
  const result = await resolveInspirationReference({ target: { ...target, referenceId: '' }, loadedVideos: [], headers, fetcher: async (url) => {
    requests.push(url);
    return { ok: true, json: async () => ({ items: [{ id: 'unrelated', platform: 'youtube', title: 'Other product', sourceUrl: 'https://other.test/post' }] }) };
  } });
  assert.equal(requests.length, 1);
  assert.match(requests[0]!, /^\/api\/overseas\/videos\?page=1&perPage=100&contentFormat=video/);
  assert.equal(result.source, 'weekly-plan-snapshot');
  assert.equal(result.video.aiAnalysis?.analysisSource, 'weekly-plan-snapshot');
  assert.equal(result.video.thumbnail, '/frozen.jpg');
});

test('read failures remain a snapshot, never a false live-analysis success', async () => {
  const result = await resolveInspirationReference({ target: { ...target, platform: 'unsupported' }, loadedVideos: [], headers, fetcher: async () => { throw Error('offline'); } });
  assert.equal(result.source, 'weekly-plan-snapshot');
  assert.equal(result.video.platform, 'tiktok');
  assert.equal(result.video.sourceUrl, target.sourceUrl);
});
