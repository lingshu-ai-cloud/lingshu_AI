import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compactVideoPipelineError,
  describeVideoAnalysisRecovery,
  publicVideoPipelineError,
  queuedVideoAnalysisFailurePatch,
  videoAnalysisRetryQueuePatch,
} from './videoAnalysisRecovery.js';

test('failed exact retry retains the previous completed evidence and its visibility', () => {
  const previous = {
    analysisMode: 'exact', analysisQuality: 'video_review_required', userVisible: true,
    gemini: { scriptDetails15s: [{ time: '0-3', visual: '产品画面' }] },
    downloadStatus: 'analyzed', videoFetchStatus: 'fetched',
  };
  const patch = queuedVideoAnalysisFailurePatch(previous, 'new attempt failed', '2026-10-23T00:00:00.000Z');
  assert.deepEqual(patch.gemini, previous.gemini);
  assert.equal(patch.userVisible, true);
  assert.equal(patch.analysisQuality, 'video_review_required');
  assert.equal(patch.geminiStatus, 'needs_review');
  assert.equal(patch.analysisQueueState, 'failed');
});

test('failed first attempt stays hidden and a new retry clears terminal failure fields', () => {
  const failed = queuedVideoAnalysisFailurePatch({}, 'download failed', '2026-10-23T00:00:00.000Z');
  assert.equal(failed.userVisible, false);
  assert.equal(failed.geminiStatus, 'video_failed');
  const queued = videoAnalysisRetryQueuePatch(failed, {
    analysisMode: 'exact', analysisRunId: 'run-2', queueKind: 'source_url',
    queuedAt: '2026-10-23T01:00:00.000Z', userId: 'owner',
  });
  assert.equal(queued.analysisQueueState, 'queued');
  assert.equal(queued.geminiStatus, 'waiting_for_video');
  assert.equal(queued.analysisError, undefined);
  assert.equal(queued.analysisFailedAt, undefined);
  assert.equal(queued.manualRequiredReason, undefined);
});

test('provider errors are sanitized before storage and public recovery text', () => {
  const secret = 'https://alice:password@example.com/path?token=top-secret&api_key=another-secret Bearer bearer-secret';
  const compact = compactVideoPipelineError(secret);
  for (const part of ['password', 'top-secret', 'another-secret', 'bearer-secret']) {
    assert.doesNotMatch(compact, new RegExp(part));
  }
  assert.match(compact, /token=\*\*\*/);
  assert.match(compact, /api_key=\*\*\*/);
  assert.match(compact, /Bearer \*\*\*/);
  assert.equal(publicVideoPipelineError('GEMINI_API_KEY is not set'), 'Gemini 未配置，请联系管理员配置后重新分析，或切换到已配置的 Qwen。');
  const recovery = describeVideoAnalysisRecovery({ analysisError: secret, userVisible: true }, 'failed');
  assert.equal(recovery.code, 'analysis_failed');
  assert.doesNotMatch(`${recovery.reason} ${recovery.recoveryAction}`, /password|top-secret|another-secret|bearer-secret/);
});
