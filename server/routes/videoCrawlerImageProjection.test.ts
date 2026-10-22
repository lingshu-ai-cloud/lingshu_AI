import assert from 'node:assert/strict';
import test from 'node:test';
import { apifyFacebookPostToImagePost, apifyInstagramItemToImagePost, apifyTikTokItemToImagePost } from './videoCrawlerImageProjection.js';

test('Instagram photo row keeps source, caption, images and public engagement evidence', () => {
  const post = apifyInstagramItemToImagePost({
    type: 'Image', ownerUsername: 'factory', shortCode: 'abc123', caption: 'Factory product #OEM',
    displayUrl: 'https://cdn.example.test/front.jpg',
    images: ['https://cdn.example.test/back.jpg', 'https://cdn.example.test/clip.mp4'],
    likesCount: 18, commentsCount: 2, ownerFollowersCount: 120,
    isPaidPartnership: true,
  }, 'OEM');
  assert.equal(post?.platform, 'instagram');
  assert.equal(post?.sourceUrl, 'https://www.instagram.com/p/abc123/');
  assert.equal(post?.caption, 'Factory product #OEM');
  assert.deepEqual(post?.imageUrls, ['https://cdn.example.test/front.jpg', 'https://cdn.example.test/back.jpg']);
  assert.equal(post?.likes, '18');
  assert.equal(post?.followers, 120);
  assert.equal(post?.isPaidPartnership, true);
});

test('Instagram videos, lookalike hosts and rows without an image remain excluded', () => {
  assert.equal(apifyInstagramItemToImagePost({ type: 'Video', shortCode: 'abc', displayUrl: 'https://cdn.example.test/a.jpg' }, 'OEM'), null);
  assert.equal(apifyInstagramItemToImagePost({ url: 'https://instagram.com.evil.test/p/abc/', displayUrl: 'https://cdn.example.test/a.jpg' }, 'OEM'), null);
  assert.equal(apifyInstagramItemToImagePost({ shortCode: 'abc' }, 'OEM'), null);
});

test('TikTok photo row retains source and image/engagement evidence', () => {
  const post = apifyTikTokItemToImagePost({
    type: 'Photo', authorMeta: { name: 'factory', fans: 50 },
    webVideoUrl: 'https://www.tiktok.com/@factory/video/1234567890',
    text: 'Workshop #OEM', imageUrls: ['https://cdn.example.test/one.jpg'],
    diggCount: 8, commentCount: 2, shareCount: 3, playCount: 40,
    isSponsored: true,
  }, 'OEM');
  assert.equal(post?.platform, 'tiktok');
  assert.equal(post?.sourceUrl, 'https://www.tiktok.com/@factory/video/1234567890');
  assert.deepEqual(post?.imageUrls, ['https://cdn.example.test/one.jpg']);
  assert.equal(post?.likes, '8');
  assert.equal(post?.followers, 50);
  assert.equal(post?.isAd, true);
});

test('TikTok video-only and spoofed source rows remain excluded', () => {
  assert.equal(apifyTikTokItemToImagePost({ type: 'Video', webVideoUrl: 'https://www.tiktok.com/@factory/video/123' }, 'OEM'), null);
  assert.equal(apifyTikTokItemToImagePost({ type: 'Photo', webVideoUrl: 'https://tiktok.com.evil.test/@factory/video/123', imageUrls: ['https://cdn.example.test/a.jpg'] }, 'OEM'), null);
});

test('Facebook image projection keeps post scope, image evidence, and engagement', () => {
  const post = apifyFacebookPostToImagePost({
    url: 'https://www.facebook.com/factory/posts/123?utm_source=feed',
    pageName: 'Factory',
    text: 'New release #product',
    likes: 14,
    media: { __typename: 'Photo', image: { uri: 'https://scontent.xx.fbcdn.net/product.jpg' } },
  }, 'manufacturing');
  assert.ok(post);
  assert.equal(post.sourceUrl, 'https://www.facebook.com/factory/posts/123');
  assert.equal(post.thumbnailUrl, 'https://scontent.xx.fbcdn.net/product.jpg');
  assert.deepEqual(post.imageUrls, ['https://scontent.xx.fbcdn.net/product.jpg']);
  assert.equal(post.author, 'Factory');
  assert.equal(post.likes, '14');
  assert.ok(post.tags.includes('product'));
});

test('Facebook image projection rejects video, search, and missing image evidence', () => {
  const image = { __typename: 'Photo', image: { uri: 'https://scontent.xx.fbcdn.net/product.jpg' } };
  assert.equal(apifyFacebookPostToImagePost({ url: 'https://www.facebook.com/factory/videos/123', media: { __typename: 'Video', is_playable: true, image } }, ''), null);
  assert.equal(apifyFacebookPostToImagePost({ url: 'https://www.facebook.com/search/posts?q=product', media: image }, ''), null);
  assert.equal(apifyFacebookPostToImagePost({ url: 'https://www.facebook.com/factory/posts/123', media: { __typename: 'Photo' } }, ''), null);
});
