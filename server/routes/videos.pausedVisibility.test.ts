import assert from 'node:assert/strict';
import { isDisplayableTestTenantVideo } from './videos.js';

const video = {
  id: 'paused-visibility-fixture',
  platform: 'tiktok',
  sourceUrl: 'https://www.tiktok.com/@fixture/video/123456789',
  title: '真实参考视频',
  thumbnailUrl: 'https://cdn.example.com/reference-cover.jpg',
  status: 'pending',
};

assert.equal(isDisplayableTestTenantVideo({ ...video, aiAnalysis: { geminiStatus: 'analyzing' } }), true);
for (const field of ['geminiStatus', 'downloadStatus', 'videoFetchStatus']) {
  assert.equal(isDisplayableTestTenantVideo({ ...video, aiAnalysis: { [field]: 'paused' } }), true,
    'pausing must preserve an already visible reference in the inventory');
}
assert.equal(isDisplayableTestTenantVideo({ ...video, aiAnalysis: JSON.stringify({ analysisPausedAt: '2026-10-10T00:00:00Z' }) }), true,
  'persisted pause markers must survive reloads');
assert.equal(isDisplayableTestTenantVideo({ ...video, aiAnalysis: {} }), false, 'idle metadata is not an active or paused reference');
assert.equal(isDisplayableTestTenantVideo({ ...video, thumbnailUrl: '', aiAnalysis: { geminiStatus: 'paused' } }), false);
assert.equal(isDisplayableTestTenantVideo({ ...video, sourceUrl: 'https://unrelated.example.com/video', aiAnalysis: { geminiStatus: 'paused' } }), false);
assert.equal(isDisplayableTestTenantVideo({ ...video, status: 'failed', aiAnalysis: { geminiStatus: 'paused' } }), false);
assert.equal(isDisplayableTestTenantVideo({ ...video, aiAnalysis: { geminiStatus: 'paused', downloadStatus: 'video_failed' } }), false,
  'pause visibility must not override a terminal media failure');
assert.equal(isDisplayableTestTenantVideo({ ...video, aiAnalysis: { geminiStatus: 'paused', adminOnlyVideoFailure: true, userVisible: false } }), false,
  'pause visibility must not override the existing administrator-only boundary');

console.log('Paused inspiration visibility tests passed');
