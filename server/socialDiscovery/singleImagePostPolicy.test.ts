import assert from 'node:assert/strict';
import test from 'node:test';
import { isGifImageBytes, isSingleStillImagePost } from './singleImagePostPolicy.js';
import type { CrawledImagePost } from './imagePostEvidenceAnalysis.js';

const post: CrawledImagePost = { platform: 'facebook', title: 'Product', sourceUrl: 'https://facebook.com/post/1',
  thumbnailUrl: 'https://cdn.example.test/one.jpg', imageUrls: ['https://cdn.example.test/one.jpg'], views: '', tags: [] };

test('only one still image is admitted; carousels and GIF links are excluded', () => {
  assert.equal(isSingleStillImagePost(post), true);
  assert.equal(isSingleStillImagePost({ ...post, imageUrls: [post.thumbnailUrl, 'https://cdn.example.test/two.jpg'] }), false);
  assert.equal(isSingleStillImagePost({ ...post, imageUrls: ['https://cdn.example.test/one.gif'] }), false);
  assert.equal(isSingleStillImagePost({ ...post, imageUrls: ['https://cdn.example.test/one?format=gif'] }), false);
  assert.equal(isSingleStillImagePost({ ...post, thumbnailUrl: 'https://cdn.example.test/preview.gif' }), false);
  assert.equal(isSingleStillImagePost({ ...post, imageUrls: [] }), true);
  assert.equal(isSingleStillImagePost({ ...post, thumbnailUrl: '', imageUrls: [] }), false);
  assert.equal(isGifImageBytes(Buffer.from('GIF89aencoded'), 'image/jpeg'), true);
  assert.equal(isGifImageBytes(Buffer.from('not-a-gif'), 'image/gif'), true);
});
