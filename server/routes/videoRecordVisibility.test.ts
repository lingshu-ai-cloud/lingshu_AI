import assert from 'node:assert/strict';
import test from 'node:test';
import { isDisplayableTestTenantVideo, isPublicImageRecord, isValidImagePostRecord,
  isVisibleVideoPipelineRecord, recordContentFormat } from './videoRecordVisibility.js';

test('a collected image remains visible when visual analysis fails, but search and video URLs do not', () => {
  const image = { platform: 'instagram', sourceUrl: 'https://www.instagram.com/p/ABC123/',
    thumbnailUrl: '', aiAnalysis: { contentFormat: 'image', imageUrls: ['https://cdn.example.test/a.jpg'],
      imageAnalysisQueueState: 'failed', userVisible: true } };
  assert.equal(recordContentFormat(image), 'image');
  assert.equal(isPublicImageRecord(image), true);
  assert.equal(isValidImagePostRecord({ ...image, sourceUrl: 'https://www.instagram.com/explore/tags/oem/' }), false);
  assert.equal(isValidImagePostRecord({ ...image, sourceUrl: 'https://www.instagram.com/reel/ABC123/' }), false);
  assert.equal(isPublicImageRecord({ ...image, aiAnalysis: { ...image.aiAnalysis, userVisible: false } }), false);
});

test('paused video visibility still requires a valid public source and real preview', () => {
  const video = { platform: 'tiktok', sourceUrl: 'https://www.tiktok.com/@factory/video/123456789',
    thumbnailUrl: 'https://cdn.example.test/preview.jpg', title: 'Factory', status: 'pending',
    aiAnalysis: { geminiStatus: 'paused' } };
  assert.equal(isDisplayableTestTenantVideo(video), true);
  assert.equal(isDisplayableTestTenantVideo({ ...video, thumbnailUrl: '' }), false);
  assert.equal(isDisplayableTestTenantVideo({ ...video, aiAnalysis: { geminiStatus: 'video_failed' } }), false);
  assert.equal(isVisibleVideoPipelineRecord({ ...video, aiAnalysis: { requestedAnalysisMode: 'exact' } }), true);
});
