import assert from 'node:assert/strict';
import test from 'node:test';
import { inferPlatformFromUrl, isPlatformUrl } from './videoCrawlerNormalization.js';
import { looksLikeAccountUrl } from './videos.js';
import { parseLinkedInCompanyPost } from './linkedinCompanyPost.js';

test('LinkedIn company source is recognized without accepting lookalike hosts or individual posts as accounts', () => {
  const company = 'https://www.linkedin.com/company/example-inc/';
  assert.equal(isPlatformUrl(company, 'linkedin'), true);
  assert.equal(inferPlatformFromUrl(company), 'linkedin');
  assert.equal(looksLikeAccountUrl(company, 'linkedin'), true);
  assert.equal(looksLikeAccountUrl('https://www.linkedin.com/posts/example_activity-1234567890', 'linkedin'), false);
  assert.equal(isPlatformUrl('https://linkedin.com.evil.example/company/example-inc', 'linkedin'), false);
  assert.equal(looksLikeAccountUrl('https://linkedin.com.evil.example/company/example-inc', 'linkedin'), false);
  assert.equal(looksLikeAccountUrl('https://www.youtube.com/@example', 'youtube'), true);
  assert.equal(looksLikeAccountUrl('https://www.youtube.com/watch?v=abcdefghijk', 'youtube'), false);
  assert.equal(looksLikeAccountUrl('https://www.tiktok.com/@example/video/123', 'tiktok'), false);
});

test('LinkedIn public image post preserves caption and media as source evidence', () => {
  const parsed = parseLinkedInCompanyPost({
    postUrl: 'https://www.linkedin.com/posts/example_activity-1234567890?utm_source=test',
    text: '产品现场 #B2B', companyName: 'Example', images: ['https://media.example.test/photo.jpg'],
    reactionCount: 12, commentCount: 3, postedAt: '2026-10-20T08:00:00Z',
  }, 'https://www.linkedin.com/company/example/');
  assert.equal(parsed?.kind, 'image');
  if (parsed?.kind !== 'image') return;
  assert.equal(parsed.item.sourceUrl, 'https://www.linkedin.com/posts/example_activity-1234567890');
  assert.equal(parsed.item.caption, '产品现场 #B2B');
  assert.deepEqual(parsed.item.tags, ['B2B']);
  assert.equal(parsed.item.likes, '12');
  assert.equal(parsed.item.uploadedAt, '2026-10-20T08:00:00.000Z');
});

test('LinkedIn source parser rejects lookalike posts and incomplete video evidence', () => {
  assert.equal(parseLinkedInCompanyPost({ postUrl: 'https://linkedin.com.evil.example/posts/a', images: ['https://media.example.test/a.jpg'] }, 'https://www.linkedin.com/company/example/'), null);
  assert.equal(parseLinkedInCompanyPost({ postUrl: 'https://www.linkedin.com/posts/example_activity-123', mediaType: 'video', thumbnail: 'https://media.example.test/a.jpg' }, 'https://www.linkedin.com/company/example/'), null);
});

test('LinkedIn video source requires a bounded public poster and duration', () => {
  const parsed = parseLinkedInCompanyPost({
    postUrl: 'https://www.linkedin.com/posts/example_activity-1234567890',
    mediaType: 'video', videoDuration: 42,
    videoThumbnail: 'https://media.example.test/video-poster.jpg',
    text: 'Factory demonstration',
  }, 'https://www.linkedin.com/company/example/');
  assert.equal(parsed?.kind, 'video');
  if (parsed?.kind !== 'video') return;
  assert.equal(parsed.item.duration, 42);
  assert.equal(parsed.item.sourceAccountUrl, 'https://www.linkedin.com/company/example/');
  assert.equal(parsed.item.caption, 'Factory demonstration');
});
