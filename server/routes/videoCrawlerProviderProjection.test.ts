import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  apifyFacebookPostToCrawledVideo,
  apifyInstagramItemToCrawledVideo,
  apifyTikTokItemToCrawledVideo,
  imageUrlsFrom,
  normalizeThumbnailUrl,
} from './videoCrawlerProviderProjection.js';
import { cleanSearchResultUrl, crawlFailureMessage, isNonRetryableVideoFetch, mergeCrawledVideos, metaToCrawledVideo, publicSearchQuery, softDownloadFailure, youtubeHtmlSearchUrl } from './videoCrawlerPublicProjection.js';

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

test('public crawl metadata preserves Shorts identity and only real image thumbnails', () => {
  const source = 'https://www.youtube.com/watch?v=AbCdEfGh123&utm_source=search';
  const projected = metaToCrawledVideo('youtube', 'factory', true)({
    webpage_url: source, title: 'Factory tour', duration: 18, view_count: 1250,
    thumbnail: 'https://example.test/clip.mp4', upload_date: '20261020', tags: ['factory', 3],
  });
  assert.equal(projected?.sourceUrl, 'https://www.youtube.com/shorts/AbCdEfGh123');
  assert.equal(projected?.youtubeShort, true);
  assert.equal(projected?.views, '1.3K');
  assert.deepEqual(projected?.tags, ['factory']);
  assert.match(projected?.thumbnailUrl || '', /AbCdEfGh123/);
  assert.equal(metaToCrawledVideo('youtube', '', true)({ title: 'No URL' }), null);
});

test('public result dedupe and search policy remain stable after projection split', () => {
  const first = { platform: 'youtube' as const, title: 'Short', sourceUrl: 'https://www.youtube.com/shorts/AbCdEfGh123', thumbnailUrl: '', duration: 12, views: '1K', tags: [] };
  const duplicate = { ...first, sourceUrl: 'https://www.youtube.com/watch?v=AbCdEfGh123&utm_source=search' };
  const original = [first];
  assert.deepEqual(mergeCrawledVideos(original, [duplicate]), [first]);
  assert.deepEqual(original, [first], 'projection must not mutate the fetched inventory');
  assert.match(publicSearchQuery('tiktok', 'factory'), /site:tiktok\.com\/@/);
  assert.equal(cleanSearchResultUrl('https://example.test/video?utm_source=feed'), 'https://example.test/video');
  assert.match(youtubeHtmlSearchUrl('factory', '2026-10-04', '2026-10-11').url, /sp=EgIIAw%253D%253D/);
  assert.equal(crawlFailureMessage('TikTok', ['quota', 'quota'], 'missing'), 'TikTok crawl failed: quota');
});

test('download failure projection keeps cookie recovery distinct from terminal evidence', () => {
  assert.deepEqual(softDownloadFailure('instagram', new Error('Login required')), { status: 'needs_cookies' });
  assert.deepEqual(softDownloadFailure('tiktok', 'private video'), { status: 'needs_cookies' });
  assert.equal(softDownloadFailure('youtube', 'private video'), null);
  assert.equal(isNonRetryableVideoFetch('youtube', 'Requested format is not available'), true);
  assert.equal(isNonRetryableVideoFetch('youtube', 'temporary timeout'), false);
});
