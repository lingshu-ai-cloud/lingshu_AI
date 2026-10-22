import assert from 'node:assert/strict';
import test from 'node:test';
import { inferPlatformFromUrl, isGenericSocialTitle, isPlatformUrl, metadataCreatorAccount, metadataTitle, metadataUploader } from './videoCrawlerNormalization.js';
import { accountLabelFromUrl, crawlImagePostsForTenant, crawlVideosForTenant, looksLikeAccountUrl } from './videos.js';
import { parseLinkedInCompanyPost } from './linkedinCompanyPost.js';
import { accountListUrlCandidates, canonicalSourceUrl, normalizeAccountListUrl, stripTrackingParams, tiktokVideoId, youtubeThumbnailFromUrl } from './videoCrawlerSourceUrls.js';

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

test('extracted account URL normalization keeps existing YouTube and social list behavior', () => {
  assert.equal(accountLabelFromUrl('https://www.youtube.com/@example'), '@example');
  assert.equal(normalizeAccountListUrl('youtube', 'https://www.youtube.com/@example/videos?utm_source=test'), 'https://www.youtube.com/@example/shorts');
  assert.deepEqual(accountListUrlCandidates('facebook', 'https://www.facebook.com/example?fbclid=123'), ['https://www.facebook.com/example/videos']);
  assert.equal(stripTrackingParams('https://www.linkedin.com/company/example/?utm_source=test'), 'https://www.linkedin.com/company/example/');
  assert.equal(youtubeThumbnailFromUrl('https://www.youtube.com/watch?v=abcdefghijk'), 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
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

test('unlicensed LinkedIn collection fails before any paid Actor or record write', async () => {
  const input = { tenantId: 'tenant-test', platform: 'linkedin' as const,
    mode: 'account' as const, accountUrl: 'https://www.linkedin.com/company/example/', limit: 5 };
  await assert.rejects(crawlVideosForTenant(input), /linkedin_company_paid_collection_permit_required/);
  await assert.rejects(crawlImagePostsForTenant(input), /linkedin_company_paid_collection_permit_required/);
});

test('provider metadata normalization keeps canonical source and creator evidence', () => {
  assert.equal(tiktokVideoId('https://www.tiktok.com/@maker/video/1234567890123456789'), '1234567890123456789');
  assert.equal(canonicalSourceUrl('tiktok', 'https://www.tiktok.com/@maker/video/1234567890123456789?utm_source=x'),
    'https://www.tiktok.com/@maker/video/1234567890123456789');
  assert.equal(canonicalSourceUrl('youtube', 'https://youtu.be/AbCdEfGhI12?si=old'),
    'https://www.youtube.com/watch?v=AbCdEfGhI12');
  const meta = { title: 'Video by creator', description: 'Factory tour\nMore detail', uploader_id: 'maker' };
  assert.equal(metadataUploader(meta), 'maker');
  assert.equal(metadataTitle('instagram', meta), 'Factory tour');
  assert.equal(metadataCreatorAccount('instagram', meta), 'https://www.instagram.com/maker');
  assert.equal(isGenericSocialTitle('Video by creator', 'instagram'), true);
});
