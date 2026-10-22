import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TrendVideo } from '../../lib/inspirationTypes';
import { imagePostAnalysisQueuePresentation } from './imagePostAnalysisPresentation';

const video: TrendVideo = {
  id: 'image-1', recordId: 'image-1', platform: 'instagram', title: '图文', thumbnail: '',
  duration: 0, tags: [], views: '', trend: 'stable', contentFormat: 'image', status: 'pending',
  aiAnalysis: { contentFormat: 'image' },
};

test('queued, processing and unknown image work is visible and not retryable', () => {
  for (const state of ['queued', 'processing', 'unknown'] as const) {
    const presentation = imagePostAnalysisQueuePresentation({ ...video, aiAnalysis: {
      ...video.aiAnalysis, imageAnalysisQueueState: state,
    } });
    assert.equal(presentation?.canReanalyze, false);
    assert.ok(presentation?.label);
  }
  assert.match(imagePostAnalysisQueuePresentation({ ...video, aiAnalysis: {
    ...video.aiAnalysis, imageAnalysisQueueState: 'unknown',
  } })?.detail || '', /核对任务与费用/);
  assert.equal(imagePostAnalysisQueuePresentation(video), null);
  assert.equal(imagePostAnalysisQueuePresentation({ ...video, contentFormat: 'video' }), null);
});
