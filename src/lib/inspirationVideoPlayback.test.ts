import assert from 'node:assert/strict';
import { isPlaybackUrlResolver, resolveInspirationPlaybackUrl } from './inspirationVideoPlayback.js';

assert.equal(isPlaybackUrlResolver('/api/overseas/videos/demo/media-url'), true);
assert.equal(isPlaybackUrlResolver('/media/demo.mp4?asset_token=test'), false);
assert.equal(await resolveInspirationPlaybackUrl('https://cdn.example.com/video.mp4'), 'https://cdn.example.com/video.mp4');

let requestCount = 0;
const resolved = await resolveInspirationPlaybackUrl('/api/overseas/videos/demo/media-url', {
  request: async () => {
    requestCount += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ url: '/media/demo.mp4?asset_token=fresh' }),
    };
  },
});
assert.equal(resolved, '/media/demo.mp4?asset_token=fresh');
assert.equal(requestCount, 1);

await assert.rejects(
  resolveInspirationPlaybackUrl('/api/overseas/videos/missing/media-url', {
    request: async () => ({ ok: false, status: 404, json: async () => ({ error: '视频不存在' }) }),
  }),
  /视频不存在/,
);

const resolverUrl = '/api/overseas/videos/demo/media-url';
const headers = { Authorization: 'Bearer fixture-token' };
let transientAttempts = 0;
assert.equal(await resolveInspirationPlaybackUrl(resolverUrl, {
  headers,
  retryDelaysMs: [0, 0, 0],
  request: async (url, init) => {
    assert.equal(url, resolverUrl);
    assert.equal(init?.headers, headers, 'retries must retain the same authorization headers');
    assert.equal(init?.credentials, 'same-origin');
    transientAttempts += 1;
    if (transientAttempts === 1) throw new TypeError('Failed to fetch');
    if (transientAttempts === 2) return { ok: false, status: 503, json: async () => ({ error: '暂时不可用' }) };
    return { ok: true, status: 200, json: async () => ({ url: '/media/recovered.mp4' }) };
  },
}), '/media/recovered.mp4');
assert.equal(transientAttempts, 3);

for (const status of [401, 403, 404]) {
  let attempts = 0;
  await assert.rejects(resolveInspirationPlaybackUrl(resolverUrl, {
    retryDelaysMs: [0, 0, 0],
    request: async () => { attempts += 1; return { ok: false, status, json: async () => ({}) }; },
  }), new RegExp(`HTTP ${status}`));
  assert.equal(attempts, 1, 'authorization and missing-resource errors must not retry');
}

let exhaustedAttempts = 0;
await assert.rejects(resolveInspirationPlaybackUrl(resolverUrl, {
  retryDelaysMs: [0, 0, 0],
  request: async () => { exhaustedAttempts += 1; return { ok: false, status: 502, json: async () => ({}) }; },
}), /HTTP 502/);
assert.equal(exhaustedAttempts, 4, 'transient failures must stop at the retry budget');

const controller = new AbortController();
let cancelledAttempts = 0;
const pendingRetry = resolveInspirationPlaybackUrl(resolverUrl, {
  signal: controller.signal,
  retryDelaysMs: [10_000],
  request: async (_url, init) => {
    cancelledAttempts += 1;
    assert.equal(init?.signal, controller.signal);
    setTimeout(() => controller.abort(new Error('preview closed')), 0);
    return { ok: false, status: 503, json: async () => ({}) };
  },
});
await assert.rejects(pendingRetry, /preview closed/);
assert.equal(cancelledAttempts, 1, 'closing the preview must cancel the backoff before a second request');

const aborted = new AbortController();
aborted.abort(new Error('already closed'));
await assert.rejects(resolveInspirationPlaybackUrl(resolverUrl, {
  signal: aborted.signal,
  request: async () => { throw new Error('request must not start'); },
}), /already closed/);

const parsingAbort = new AbortController();
await assert.rejects(resolveInspirationPlaybackUrl(resolverUrl, {
  signal: parsingAbort.signal,
  request: async () => ({ ok: true, status: 200, json: async () => {
    parsingAbort.abort(new Error('closed while reading'));
    return { url: '/media/stale.mp4' };
  } }),
}), /closed while reading/);

console.log('Inspiration video playback tests passed');
