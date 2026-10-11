import assert from 'node:assert/strict';
import { isDisplayableTestTenantVideo, queuedVideoAnalysisFailurePatch } from './videos.js';

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

const completedExact = {
  analysisMode: 'exact', analysisQuality: 'video_review_required', geminiStatus: 'needs_review', userVisible: true,
  downloadStatus: 'analyzed', videoFetchStatus: 'fetched',
  gemini: { scriptDetails15s: [{ time: '0-4.7s', visual: '产品近景' }, { time: '4.7-9.41s', visual: '工厂全景' }] },
};
const failedRetry = queuedVideoAnalysisFailurePatch(completedExact, 'provider model unavailable', '2026-10-11T00:00:00Z');
assert.equal(failedRetry.userVisible, true, 'a failed retry must preserve the prior user visibility decision');
assert.equal(failedRetry.geminiStatus, 'needs_review', 'the retained exact evidence remains reviewable rather than becoming a missing video');
assert.equal(failedRetry.analysisQueueState, 'failed');
assert.equal(isDisplayableTestTenantVideo({ ...video, status: 'analyzed', aiAnalysis: failedRetry }), true,
  'completed exact evidence remains in the inspiration inventory after a failed upgrade');
const firstFailure = queuedVideoAnalysisFailurePatch({ analysisQuality: 'pending', userVisible: true }, 'provider failed', '2026-10-11T00:00:00Z');
assert.equal(firstFailure.userVisible, false, 'a first analysis failure without completed evidence stays hidden');
assert.equal(isDisplayableTestTenantVideo({ ...video, status: 'analyzed', aiAnalysis: firstFailure }), false);

console.log('Paused inspiration visibility tests passed');
