import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  apifyFacebookPostToCrawledVideo,
  apifyInstagramItemToCrawledVideo,
  apifyTikTokItemToCrawledVideo,
  imageUrlsFrom,
  normalizeThumbnailUrl,
} from './videoCrawlerProviderProjection.js';

test('TikTok maps only a video with a real short-video duration', () => {
  const source = 'https://www.tiktok.com/@maker/video/1234567890123456789';
  const item = {
    webVideoUrl: source, text: '新产品 #launch', videoMeta: { duration: 15 },
    coverUrl: 'https://example.com/cover.jpg', playCount: 1250, hashtags: ['launch'],
    authorMeta: { name: 'maker' },
  };
  const projected = apifyTikTokItemToCrawledVideo(item, '新品');
  assert.equal(projected?.sourceUrl, source);
  assert.equal(projected?.views, '1.3K');
  assert.equal(projected?.duration, 15);
  assert.equal(apifyTikTokItemToCrawledVideo({ ...item, isSlideshow: true }, '新品'), null);
  assert.equal(apifyTikTokItemToCrawledVideo({ ...item, videoMeta: { duration: 75 } }, '新品'), null);
  assert.equal(apifyTikTokItemToCrawledVideo({ ...item, webVideoUrl: 'https://tiktok.example/video/123' }, '新品'), null);
});

test('Instagram keeps reel metadata and rejects image-only rows', () => {
  const reel = apifyInstagramItemToCrawledVideo({
    type: 'Video', url: 'https://www.instagram.com/reel/ABC123/',
    caption: '真实生产现场', displayUrl: 'https://example.com/ig.jpg',
    videoDuration: 21, videoPlayCount: 3500, ownerUsername: 'maker',
  }, '生产');
  assert.equal(reel?.sourceUrl, 'https://www.instagram.com/reel/ABC123/');
  assert.equal(reel?.views, '3.5K');
  assert.equal(reel?.sourceAccountUrl, 'https://www.instagram.com/maker');
  assert.equal(apifyInstagramItemToCrawledVideo({ type: 'Image', url: 'https://www.instagram.com/p/ABC123/' }, '生产'), null);
});

test('Facebook requires nested playable video media and keeps the page identity', () => {
  const accountUrl = 'https://www.facebook.com/examplebrand';
  const projected = apifyFacebookPostToCrawledVideo({
    pageName: 'Example Brand', pageUrl: accountUrl,
    text: 'Video #factory', shares: 1200,
    media: [{ __typename: 'Video', url: 'https://www.facebook.com/watch/?v=123456789012345',
      playable_duration_in_ms: 18000, thumbnail: 'https://example.com/fb.jpg' }],
  }, accountUrl);
  assert.equal(projected?.duration, 18);
  assert.equal(projected?.views, '1.2K shares');
  assert.equal(projected?.sourceAccountUrl, accountUrl);
  assert.equal(apifyFacebookPostToCrawledVideo({ media: [{ __typename: 'Photo', url: 'https://www.facebook.com/p/1' }] }, accountUrl), null);
});

test('thumbnail projection excludes video files and deduplicates images', () => {
  assert.equal(normalizeThumbnailUrl('https://example.com/clip.mp4'), '');
  assert.equal(normalizeThumbnailUrl('/api/overseas/videos/record-1/thumbnail'), '/api/overseas/videos/record-1/thumbnail');
  assert.deepEqual(imageUrlsFrom([
    { images: [{ url: 'https://example.com/one.jpg' }, { url: 'https://example.com/one.jpg' }] },
    'https://example.com/clip.mp4',
  ]), ['https://example.com/one.jpg']);
});
