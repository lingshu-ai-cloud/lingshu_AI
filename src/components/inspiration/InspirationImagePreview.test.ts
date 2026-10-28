import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TrendVideo } from '../../lib/inspirationTypes';
import { imagePreviewGesture, inspirationImageSources } from './InspirationImagePreview';

test('image preview keeps collected image order and falls back only when no originals exist', () => {
  const video = { thumbnail: '/thumbnail', aiAnalysis: { imageUrls: ['/first', '/second', '/first', ' '] } } as TrendVideo;
  assert.deepEqual(inspirationImageSources(video), ['/first', '/second']);
  assert.deepEqual(inspirationImageSources({ ...video, aiAnalysis: { imageUrls: [] } }), ['/thumbnail']);
  assert.deepEqual(inspirationImageSources({ ...video, thumbnail: '', aiAnalysis: {} }), []);
});

test('horizontal swipes switch images without confusing short or vertical gestures', () => {
  assert.equal(imagePreviewGesture(-90, 8), 'next');
  assert.equal(imagePreviewGesture(90, -8), 'previous');
  assert.equal(imagePreviewGesture(20, -100), 'post');
  assert.equal(imagePreviewGesture(49, 20), null);
  assert.equal(imagePreviewGesture(60, 60), null);
});
