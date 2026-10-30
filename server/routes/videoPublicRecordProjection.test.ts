import assert from 'node:assert/strict';
import test from 'node:test';
import { analysisQueuePositions, publicVideoRecord, recordMatchesKeyword } from './videoPublicRecordProjection.js';

test('stored historical thumbnails use the authenticated media owner before remote YouTube fallback', () => {
  const source = { id: 'historical-video', thumbnailUrl: '', platform: 'youtube', sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk', aiAnalysis: JSON.stringify({ thumbnailObjectKey: 'tenant/thumb.jpg' }) };
  assert.equal(publicVideoRecord(source).thumbnailUrl, '/api/overseas/videos/historical-video/thumbnail');
  assert.match(String(publicVideoRecord({ ...source, aiAnalysis: '{}' }).thumbnailUrl), /^https:\/\//);
});

test('public video projection preserves visible progress but strips private evidence keys', () => {
  const source = { id: 'video-a', platform: 'tiktok', sourceUrl: 'https://www.tiktok.com/@a/video/123',
    aiAnalysis: { analysisQueueKind: 'material', analysisQueueState: 'queued', analysisRunId: 'run-a',
      analysisQueuedAt: '2026-10-20T00:00:00.000Z', userVisible: true,
      analysisError: 'private provider detail',
      gemini: { scriptDetails15s: [{ time: '0-2s', materialEvidence: {
        clipObjectKey: 'secret-clip', firstFrameObjectKey: 'secret-frame', frameUrl: '/media/frame.jpg',
      } }] } } };
  const result = publicVideoRecord(source, { queuePosition: 2, nowMs: Date.parse('2026-10-20T00:01:00.000Z') });
  const analysis = JSON.parse(String(result.aiAnalysis));
  assert.equal(analysis.analysisProgress.queuePosition, 2);
  assert.equal(analysis.analysisProgress.backendAccepted, true);
  assert.equal(analysis.userVisible, undefined);
  assert.equal(analysis.analysisError, undefined);
  assert.deepEqual(analysis.gemini.scriptDetails15s[0].materialEvidence, { frameUrl: '/media/frame.jpg' });
  assert.equal(source.aiAnalysis.analysisError, 'private provider detail');
  const encoded = publicVideoRecord({ ...source, aiAnalysis: JSON.stringify({ ...source.aiAnalysis,
    gemini: JSON.stringify({ scriptDetails15s: [JSON.stringify({ materialEvidence: JSON.stringify({
      clipObjectKey: 'hidden', frameUrl: '/media/frame.jpg',
    }) })] }) }) });
  assert.deepEqual(JSON.parse(String(encoded.aiAnalysis)).gemini.scriptDetails15s[0].materialEvidence,
    { frameUrl: '/media/frame.jpg' });
});

test('only accepted durable analysis jobs receive stable queue positions', () => {
  const queued = (id: string, at: string, runId = id) => ({ id, aiAnalysis: { analysisQueueKind: 'material',
    analysisQueueState: 'queued', analysisRunId: runId, analysisQueuedAt: at } });
  const positions = analysisQueuePositions([
    queued('later', '2026-10-20T00:02:00Z'), queued('earlier', '2026-10-20T00:01:00Z'),
    queued('unaccepted', '2026-10-20T00:00:00Z', ''),
  ], Date.parse('2026-10-20T00:03:00Z'));
  assert.deepEqual([...positions], [['earlier', 1], ['later', 2]]);
});

test('keyword projection matches title, tags and analysis without treating URLs as keywords', () => {
  const record = { title: 'Factory line', tags: '["OEM"]', aiAnalysis: { gemini: { theme: 'Industrial' } } };
  assert.equal(recordMatchesKeyword(record, 'oem'), true);
  assert.equal(recordMatchesKeyword(record, 'industrial'), true);
  assert.equal(recordMatchesKeyword(record, 'retail'), false);
  assert.equal(recordMatchesKeyword(record, 'https://example.test/source'), true);
});

test('public failure stage survives sanitization while private provider text is removed', () => {
  const result = publicVideoRecord({ id: 'quota', aiAnalysis: JSON.stringify({ analysisError: '403 platform-feature-disabled Monthly usage hard limit exceeded private-secret' }) });
  const analysis = JSON.parse(String(result.aiAnalysis));
  assert.equal(analysis.pipelineFailure.code, 'collection_quota');
  assert.equal(analysis.pipelineFailure.stage, 'collection');
  assert.doesNotMatch(String(result.aiAnalysis), /private-secret/);
});

test('repeated listing projections preserve the sanitized failure reason and progress copy', () => {
  for (const [error, code] of [['Request timed out.', 'timeout'], ['DataInspectionFailed', 'content_rejected'], ['Monthly usage hard limit exceeded', 'collection_quota']]) {
    const record = { id: 'legacy-failure', status: 'analyzed', aiAnalysis: JSON.stringify({ geminiStatus: 'failed', analysisError: error }) };
    const once = publicVideoRecord(record);
    const twice = publicVideoRecord(once);
    const analysis = JSON.parse(String(twice.aiAnalysis));
    assert.equal(analysis.pipelineFailure.code, code);
    assert.equal(analysis.analysisProgress.currentStep, JSON.parse(String(once.aiAnalysis)).analysisProgress.currentStep);
    assert.equal(analysis.analysisProgress.retryable, analysis.pipelineFailure.retryable);
    assert.equal(analysis.analysisError, undefined);
  }
});
