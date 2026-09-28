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

console.log('Inspiration video playback tests passed');
