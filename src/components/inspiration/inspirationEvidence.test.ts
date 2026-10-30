import assert from 'node:assert/strict';
import test from 'node:test';
import type { TrendVideo } from '../../lib/inspirationTypes';
import { observedVideoAnalysis, failureForVideo, imageAnalysisNeedsSubmission } from './inspirationEvidence';
import { metadataPanelFallback, recordsToVideos } from './inspirationVideoProjection';
import { videoPipelineFailure } from '../../../shared/videoPipelineFailure';

const base: TrendVideo = { id: 'a', title: 'source title', platform: 'youtube', thumbnail: '',
  duration: 10, views: '', tags: [], trend: 'stable', contentFormat: 'video' };
const template = { theme: 'unverified template', hooks: ['generic promise'] } as NonNullable<TrendVideo['aiAnalysis']>['gemini'];

test('metadata templates never become verified hooks or selling points', () => {
  const metadata = { ...base, aiAnalysis: { gemini: template, analysisQuality: 'metadata' as const, analysisSource: 'metadata-fallback' } };
  assert.equal(observedVideoAnalysis(metadata), undefined);
  assert.equal(metadataPanelFallback(metadata).aiAnalysis?.gemini, undefined);
  const [projected] = recordsToVideos([{ id: 'a', platform: 'youtube', title: base.title,
    aiAnalysis: JSON.stringify(metadata.aiAnalysis) }]);
  assert.equal(projected.aiAnalysis?.gemini, undefined);
  const [empty] = recordsToVideos([{ id: 'b', platform: 'youtube', title: base.title }]);
  assert.equal(empty.aiAnalysis?.gemini, undefined);
  assert.equal(metadata.aiAnalysis.gemini, template, 'projection must not mutate stored evidence');
});

test('verified prior evidence remains visible after a failed subsequent attempt', () => {
  assert.equal(observedVideoAnalysis({ ...base, aiAnalysis: { gemini: template, analysisQuality: 'video', analysisError: 'retry timed out' } }), template);
  assert.equal(observedVideoAnalysis({ ...base, aiAnalysis: { gemini: template, geminiStatus: 'video_failed' } }), undefined);
});

test('failure and unsubmitted image states are explicit while queued or uncertain attempts are not resubmitted', () => {
  assert.equal(failureForVideo({ ...base, status: 'failed', aiAnalysis: { pipelineFailure: videoPipelineFailure('') } }).code, 'analysis_failed');
  assert.equal(failureForVideo({ ...base, aiAnalysis: { analysisError: 'DataInspectionFailed' } }).retryable, false);
  const locked = { ...base, aiAnalysis: { pipelineFailure: videoPipelineFailure('timeout'), analysisProgress: { stage: 'failed', retryable: false } } } as TrendVideo;
  assert.equal(failureForVideo(locked).retryable, false, 'an explicit backend no-retry state must not expose a new paid attempt');
  const image = { ...base, contentFormat: 'image' as const, aiAnalysis: { imageAnalysisStatus: 'pending' as const } };
  assert.equal(imageAnalysisNeedsSubmission(image), true);
  for (const state of ['queued', 'processing', 'unknown'] as const) {
    assert.equal(imageAnalysisNeedsSubmission({ ...image, aiAnalysis: { ...image.aiAnalysis, imageAnalysisQueueState: state } }), false);
  }
});
