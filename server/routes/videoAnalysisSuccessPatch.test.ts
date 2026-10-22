import assert from 'node:assert/strict';
import test from 'node:test';
import type { VideoAiAnalysis } from '../types/index.js';
import { videoLevelSuccessPatch } from './videoAnalysisSuccessPatch.js';

test('successful video analysis clears stale failure and freezes one completion timestamp', () => {
  const analysis = { theme: 'Factory', firstTenSeconds: { atmosphere: 'bright', camera: 'close', visuals: 'product' },
    coarseStructure: [{ description: 'Product opening' }],
    scriptDetails15s: [{ time: '0-5s', visual: 'Product on table' }] } as VideoAiAnalysis;
  const patch = videoLevelSuccessPatch({ analysis, source: 'gemini-video', videoFetchStatus: 'fetched',
    now: () => new Date('2026-10-23T08:00:00.000Z') });
  assert.equal(patch.analysisQuality, 'video');
  assert.equal(patch.userVisible, true);
  assert.equal(patch.analysisError, undefined);
  assert.equal(patch.videoLevelFailureStatus, undefined);
  assert.equal(patch.analysisQueueState, 'completed');
  assert.equal(patch.analysisCompletedAt, '2026-10-23T08:00:00.000Z');
  assert.equal(patch.analyzedAt, patch.analysisCompletedAt);
});

test('incomplete model output never receives a success patch', () => {
  assert.throws(() => videoLevelSuccessPatch({ analysis: { theme: 'metadata only' } as VideoAiAnalysis,
    source: 'gemini-video', videoFetchStatus: 'fetched' }), /incomplete_gemini_video_analysis/);
});
