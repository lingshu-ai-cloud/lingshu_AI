import assert from 'node:assert/strict';
import { fetchViralFirstRow, viralRecordToVideo } from './viralVideoFeed';

assert.equal(viralRecordToVideo({ id: 'image', platform: 'tiktok', sourceUrl: 'https://example.com/image', aiAnalysis: '{"contentFormat":"image"}' }), null);
assert.equal(viralRecordToVideo({ id: 'bad', platform: 'unknown', sourceUrl: 'https://example.com/video' }), null);
assert.equal(viralRecordToVideo({ id: 'no-source', platform: 'tiktok' }), null);
assert.equal(viralRecordToVideo({ id: 'failed', platform: 'tiktok', sourceUrl: 'https://example.com/failed', status: 'failed' }), null);
const mapped = viralRecordToVideo({ id: 'v1', platform: 'tiktok', title: '真实视频', videoFileId: 'file', aiAnalysis: '{"views":"200"}' });
assert.equal(mapped?.recordId, 'v1');
assert.equal(mapped?.videoUrl, '/api/overseas/videos/v1/media-url');
assert.equal(mapped?.views, '200');

const previousFetch = globalThis.fetch;
const previousStorage = globalThis.localStorage;
try {
  globalThis.localStorage = { getItem: () => null } as unknown as Storage;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    assert.equal(String(input), '/api/overseas/videos?page=1&perPage=100&contentFormat=video&crawlRange=all');
    return new Response(JSON.stringify({ items: [
      { id: 'older', platform: 'youtube', sourceUrl: 'https://example.com/older', crawledAt: '2026-10-20T00:00:00Z' },
      { id: 'newer', platform: 'tiktok', sourceUrl: 'https://example.com/newer', crawledAt: '2026-10-22T00:00:00Z' },
      { id: 'duplicate', platform: 'tiktok', sourceUrl: 'https://example.com/newer', crawledAt: '2026-10-21T00:00:00Z' },
      { id: 'image', platform: 'instagram', sourceUrl: 'https://example.com/image', aiAnalysis: '{"contentFormat":"image"}' },
    ] }), { status: 200 });
  }) as typeof fetch;
  const videos = await fetchViralFirstRow(new AbortController().signal);
  assert.deepEqual(videos.map(video => video.recordId), ['newer', 'older']);
} finally {
  globalThis.fetch = previousFetch;
  globalThis.localStorage = previousStorage;
}

console.log('Viral first-row feed contracts passed');
