import assert from 'node:assert/strict';
import { crawlerMediaUrls, isPlaybackResolver } from './inspirationMedia';

assert.equal(isPlaybackResolver('/api/overseas/videos/abc/media-url'), true);
assert.equal(isPlaybackResolver('/api/overseas/videos/abc/media-url?x=1'), true);
for (const url of ['/media/clip.mp4?assetToken=test', 'https://example.com/video.mp4', 'blob:local', '/api/overseas/videos/abc/media']) {
  assert.equal(isPlaybackResolver(url), false, 'direct media must not be parsed as JSON');
}
assert.deepEqual(crawlerMediaUrls({ id: 'abc', thumbnailUrl: 'https://external/expired.jpg', thumbnailFile: 'cover.jpg', videoFileId: 'video.mp4' }, {}), {
  thumbnail: '/api/overseas/videos/abc/thumbnail', videoUrl: '/api/overseas/videos/abc/media-url',
});
assert.deepEqual(crawlerMediaUrls({ id: 'abc' }, { videoObjectKey: 'video.mp4', thumbnailObjectKey: 'cover.jpg' }), {
  thumbnail: '/api/overseas/videos/abc/thumbnail', videoUrl: '/api/overseas/videos/abc/media-url',
});
assert.deepEqual(crawlerMediaUrls({ id: 'abc', thumbnailUrl: 'https://external/cover.jpg' }, {}), {
  thumbnail: 'https://external/cover.jpg', videoUrl: undefined,
});
assert.deepEqual(crawlerMediaUrls({ id: 'abc', videoFileId: 'video.mp4' }, {}), {
  thumbnail: '/api/overseas/videos/abc/thumbnail', videoUrl: '/api/overseas/videos/abc/media-url',
});
console.log('inspiration media regression tests passed');
