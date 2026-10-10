import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildVideoAnalysisProgress,
  hasDurableExactAnalysisOwner,
  isOwnerlessExactAnalysisStale,
  sourceAnalysisQueueFailurePatch,
  sourceAnalysisQueueReceiptPatch,
} from './videoAnalysisProgress.js';

const nowMs = Date.parse('2026-10-09T07:00:00.000Z');

test('metadata fallback is not reported as completed or accepted analysis', () => {
  const progress = buildVideoAnalysisProgress({
    analysis: { analysisSource: 'metadata-fallback', analysisQuality: 'metadata', geminiStatus: 'metadata_fallback' },
    recordStatus: 'analyzed', duration: 33, nowMs,
  });
  assert.equal(progress.stage, 'metadata');
  assert.equal(progress.backendAccepted, false);
  assert.equal(progress.workerStarted, false);
  assert.equal(progress.etaSeconds, null);
});

test('queued exact analysis distinguishes durable acceptance from worker start', () => {
  const progress = buildVideoAnalysisProgress({
    analysis: {
      requestedAnalysisMode: 'exact', analysisRunMode: 'exact', analysisRunId: 'run-1',
      analysisQueueKind: 'stored_video', analysisQueueState: 'queued',
      analysisQueuedAt: '2026-10-09T06:59:00.000Z', geminiStatus: 'queued',
    },
    recordStatus: 'pending', duration: 33, queuePosition: 2, nowMs,
  });
  assert.equal(progress.stage, 'queued');
  assert.equal(progress.backendAccepted, true);
  assert.equal(progress.workerStarted, false);
  assert.equal(progress.queuePosition, 2);
  assert.equal(progress.percent, null, 'legacy queue state without a persisted milestone must not invent a percentage');
  assert.equal(progress.etaSeconds, null);
});

test('worker timestamps expose the real active stage without inventing a percentage', () => {
  const progress = buildVideoAnalysisProgress({
    analysis: {
      requestedAnalysisMode: 'exact', analysisRunMode: 'exact', analysisRunId: 'run-2',
      analysisQueueState: 'running', analysisStage: 'extracting_evidence',
      analysisWorkerStartedAt: '2026-10-09T06:55:00.000Z',
      analysisStageUpdatedAt: '2026-10-09T06:59:30.000Z',
    },
    duration: 45, nowMs,
  });
  assert.equal(progress.stage, 'extracting_evidence');
  assert.equal(progress.percent, null);
  assert.equal(progress.workerStarted, true);
  assert.equal(progress.etaSeconds, null);
});

test('an active percentage is exposed only when the Worker records a measured value', () => {
  const progress = buildVideoAnalysisProgress({
    analysis: {
      requestedAnalysisMode: 'exact', analysisRunMode: 'exact', analysisRunId: 'run-measured',
      analysisQueueState: 'running', analysisStage: 'analyzing', analysisMeasuredPercent: 43,
      analysisWorkerStartedAt: '2026-10-09T06:55:00.000Z',
    },
    nowMs,
  });
  assert.equal(progress.stage, 'analyzing');
  assert.equal(progress.percent, 43);
});

test('null, blank, and string progress values do not masquerade as measured backend percentages', () => {
  for (const analysisMeasuredPercent of [null, '', '43']) {
    const progress = buildVideoAnalysisProgress({
      analysis: {
        requestedAnalysisMode: 'exact', analysisRunMode: 'exact', analysisRunId: 'run-unmeasured',
        analysisQueueState: 'running', analysisStage: 'analyzing', analysisMeasuredPercent,
        analysisWorkerStartedAt: '2026-10-09T06:55:00.000Z',
      },
      nowMs,
    });
    assert.equal(progress.percent, null);
  }
});

test('ETA is exposed only when the backend supplies an explicit estimate', () => {
  const progress = buildVideoAnalysisProgress({
    analysis: {
      requestedAnalysisMode: 'exact', analysisRunMode: 'exact', analysisRunId: 'run-eta',
      analysisQueueState: 'running', analysisStage: 'analyzing',
      analysisWorkerStartedAt: '2026-10-09T06:55:00.000Z', analysisEtaSeconds: 180,
    },
    nowMs,
  });
  assert.equal(progress.etaSeconds, 180);
  assert.equal(progress.estimatedCompletedAt, '2026-10-09T07:03:00.000Z');
});

test('legacy maintenance marker without worker evidence does not claim worker start or ETA', () => {
  const progress = buildVideoAnalysisProgress({
    analysis: {
      requestedAnalysisMode: 'exact', analysisRunMode: 'exact', analysisRunId: 'run-old',
      analysisQueueKind: 'maintenance_exact', analysisQueueState: 'running', geminiStatus: 'analyzing',
      analysisStartedAt: '2026-10-07T00:00:00.000Z',
    },
    recordStatus: 'pending', nowMs,
  });
  assert.equal(progress.backendAccepted, false);
  assert.equal(progress.workerStarted, false);
  assert.equal(progress.percent, null);
  assert.equal(progress.etaSeconds, null);
});

test('maintenance_exact is not mistaken for a durable Worker-owned queue', () => {
  assert.equal(hasDurableExactAnalysisOwner({ analysisQueueState: 'queued', analysisQueueKind: 'material' }), true);
  assert.equal(hasDurableExactAnalysisOwner({ analysisQueueState: 'running', analysisQueueKind: 'stored_video' }), true);
  assert.equal(hasDurableExactAnalysisOwner({ analysisQueueState: 'running', analysisQueueKind: 'maintenance_exact' }), false);
});

test('maintenance recovery releases the October 7 orphan but preserves a recent live script', () => {
  const common = {
    requestedAnalysisMode: 'exact', analysisQueueKind: 'maintenance_exact',
    analysisQueueState: 'running', geminiStatus: 'analyzing',
  };
  assert.equal(isOwnerlessExactAnalysisStale({
    analysis: { ...common, analysisStartedAt: '2026-10-07T00:00:00.000Z' },
    recordUpdatedAt: '2026-10-07T00:02:00.000Z', nowMs, stallMs: 5 * 60_000,
  }), true);
  assert.equal(isOwnerlessExactAnalysisStale({
    analysis: { ...common, analysisStartedAt: '2026-10-09T06:45:00.000Z', analysisHeartbeatAt: '2026-10-09T06:59:30.000Z' },
    nowMs, stallMs: 5 * 60_000,
  }), false);
  assert.equal(isOwnerlessExactAnalysisStale({
    analysis: { ...common, analysisStartedAt: '2026-10-09T06:45:00.000Z' },
    recordUpdatedAt: '2026-10-09T06:59:30.000Z', nowMs, stallMs: 5 * 60_000,
  }), false, 'a schema-backed maintenance touch must keep the owner live without rewriting aiAnalysis');
});

test('source analysis queue receipt and enqueue failure are explicit terminal contracts', () => {
  assert.deepEqual(sourceAnalysisQueueReceiptPatch({ id: 'ops-1', status: 'queued' }, '2026-10-09T07:00:00.000Z'), {
    crawlerOpsTaskId: 'ops-1', crawlerOpsStatus: 'queued', analysisQueueState: 'queued',
    analysisStage: 'queued', analysisStageUpdatedAt: '2026-10-09T07:00:00.000Z',
  });
  assert.throws(() => sourceAnalysisQueueReceiptPatch({ id: '', status: 'queued' }, '2026-10-09T07:00:00.000Z'), /receipt_missing/);
  assert.throws(() => sourceAnalysisQueueReceiptPatch({ id: 'ops-2', status: 'failed' }, '2026-10-09T07:00:00.000Z'), /not_accepted/);
  assert.deepEqual(sourceAnalysisQueueFailurePatch('queue unavailable', '2026-10-09T07:00:00.000Z'), {
    requestedAnalysisMode: undefined, analysisQueueState: 'failed', analysisStage: 'failed',
    analysisStageUpdatedAt: '2026-10-09T07:00:00.000Z', analysisFailedAt: '2026-10-09T07:00:00.000Z',
    analysisRetryable: true, geminiStatus: 'analysis_retryable', downloadStatus: 'ops_failed',
    videoFetchStatus: 'ops_failed', analysisError: 'queue unavailable', videoLevelFailureStatus: '后台分析入队失败，可重试',
  });
});

test('stalled terminal state is retryable and has no invented ETA', () => {
  const progress = buildVideoAnalysisProgress({
    analysis: {
      analysisRunId: 'run-old', analysisQueueState: 'failed', geminiStatus: 'analysis_retryable',
      analysisError: 'exact_analysis_stalled', analysisRetryable: true,
    },
    recordStatus: 'analyzed', failureMessage: '后台分析中断，可重试或恢复。', nowMs,
  });
  assert.equal(progress.stage, 'failed');
  assert.equal(progress.retryable, true);
  assert.equal(progress.percent, null);
  assert.equal(progress.etaSeconds, null);
  assert.equal(progress.currentStep, '后台分析中断，可重试或恢复。');
});
