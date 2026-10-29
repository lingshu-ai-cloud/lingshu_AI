import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataStore } from '../storage/datastore.js';
import { reanalyzeStoredImagePost } from './imagePostReanalysis.js';

const evidence = { version: 2 as const, status: 'analyzed' as const,
  observedFacts: [{ imageIndex: 1, subjects: ['bottle'], scene: 'studio', composition: 'center', colors: [], visibleText: [], confidence: .9 }],
  carouselFlow: [], copyEvidence: { hooks: [], sellingPoints: [], cta: [] }, reusableModules: [], uncertainties: [] };

function fixture(options: { failStart?: boolean; failFinish?: boolean; changeSource?: boolean; unknownProvider?: boolean } = {}) {
  const events: string[] = [];
  let row: Record<string, unknown> = {
    id: 'record-1', tenantId: 'tenant-1', contentFormat: 'image', platform: 'instagram',
    sourceUrl: 'https://example.test/post/1', thumbnailUrl: '/media/record-1.png',
    title: 'Bottle', tags: '["factory"]', status: 'analyzed',
    aiAnalysis: JSON.stringify({ contentFormat: 'image', caption: 'Bottle caption', keyword: 'bottle',
      imageUrls: ['/api/overseas/videos/record-1/image/0'], imageObjectKeys: ['image-1'] }),
  };
  let updates = 0;
  const store = {
    async getById() { return structuredClone(row); },
    async update(_collection: string, _id: string, patch: Record<string, unknown>) {
      events.push(`update-${++updates}`);
      if ((options.failStart && updates === 1) || (options.failFinish && updates === 2)) return false;
      row = { ...row, ...patch };
      return true;
    },
  } as unknown as DataStore;
  const record = structuredClone(row);
  const input = { store, collection: 'trend_videos', tenantId: 'tenant-1', record,
    async analyze(item: { imageUrls?: string[]; caption?: string }, keyword: string) {
      events.push('analyze');
      assert.equal(row.status, 'pending');
      assert.equal(JSON.parse(String(row.aiAnalysis)).imageAnalysisQueueState, 'processing');
      assert.equal(item.imageUrls?.[0], '/api/overseas/videos/record-1/image/0');
      assert.equal(item.caption, 'Bottle caption');
      assert.equal(keyword, 'bottle');
      if (options.changeSource) row = { ...row, sourceUrl: 'https://example.test/post/2' };
      if (options.unknownProvider) return { status: 'failed' as const, error: 'transport uncertain', providerAttempted: true };
      return { status: 'analyzed' as const, analysis: evidence, provider: 'qwen' as const };
    },
  };
  return { input, events, get row() { return row; } };
}

test('manual reanalysis persists attempt before provider and result after it', async () => {
  const f = fixture();
  const result = await reanalyzeStoredImagePost(f.input);
  assert.equal(result.status, 'analyzed');
  assert.deepEqual(f.events, ['update-1', 'analyze', 'update-2']);
  assert.equal(f.row.status, 'analyzed');
  assert.equal(JSON.parse(String(f.row.aiAnalysis)).imageEvidence.observedFacts[0].subjects[0], 'bottle');
});

test('failed attempt persistence prevents provider call and failed result write stays pending', async () => {
  const start = fixture({ failStart: true });
  await assert.rejects(reanalyzeStoredImagePost(start.input), /attempt_persistence_failed/);
  assert.deepEqual(start.events, ['update-1']);
  const finish = fixture({ failFinish: true });
  await assert.rejects(reanalyzeStoredImagePost(finish.input), /result_persistence_failed/);
  assert.deepEqual(finish.events, ['update-1', 'analyze', 'update-2']);
  assert.equal(finish.row.status, 'pending');
});

test('changed source after provider response is not overwritten by stale evidence', async () => {
  const f = fixture({ changeSource: true });
  await assert.rejects(reanalyzeStoredImagePost(f.input), /source_changed/);
  assert.deepEqual(f.events, ['update-1', 'analyze']);
  assert.equal(f.row.sourceUrl, 'https://example.test/post/2');
});

test('cross-tenant input is rejected before any write or provider call', async () => {
  const f = fixture();
  await assert.rejects(reanalyzeStoredImagePost({ ...f.input, tenantId: 'tenant-2' }), /tenant_mismatch/);
  assert.deepEqual(f.events, []);
});

test('active or unknown deferred work blocks a second manual supplier call', async () => {
  const f = fixture();
  f.input.record.aiAnalysis = JSON.stringify({ ...JSON.parse(String(f.input.record.aiAnalysis)), imageAnalysisQueueState: 'unknown' });
  await assert.rejects(reanalyzeStoredImagePost(f.input), /requires_reconciliation/);
  assert.deepEqual(f.events, []);
});

test('unknown provider outcome stays durable and cannot be paid again automatically', async () => {
  const f = fixture({ unknownProvider: true });
  await assert.rejects(reanalyzeStoredImagePost(f.input), /image_post_analysis_provider_result_unknown/);
  const analysis = JSON.parse(String(f.row.aiAnalysis));
  assert.equal(analysis.imageAnalysisStatus, 'unknown');
  assert.equal(analysis.imageAnalysisQueueState, 'unknown');
  await assert.rejects(reanalyzeStoredImagePost({ ...f.input, record: f.row }), /requires_reconciliation/);
  assert.equal(f.events.filter(event => event === 'analyze').length, 1);
});

test('a proven blocked request records a failure while a supplier receipt is retained with successful evidence', async () => {
  const blocked = fixture();
  await reanalyzeStoredImagePost({ ...blocked.input,
    analyze: async () => ({ status: 'failed', error: 'image_post_analysis_network_blocked', providerAttempted: false }) });
  const analysis = JSON.parse(String(blocked.row.aiAnalysis));
  assert.equal(analysis.imageAnalysisQueueState, 'failed');
  assert.equal(analysis.imageAnalysisError, 'image_post_analysis_network_blocked');
  const success = fixture();
  const receipt = { startedAt: '2026-10-29T00:00:00Z', endpoint: 'https://example.test/chat/completions', status: 200,
    requestId: 'request-1', completionId: 'completion-1', model: 'vision', usage: { total_tokens: 100 } };
  await reanalyzeStoredImagePost({ ...success.input,
    analyze: async () => ({ status: 'analyzed', analysis: evidence, provider: 'qwen', providerAudit: [receipt] }) });
  assert.deepEqual(JSON.parse(String(success.row.aiAnalysis)).imageAnalysisProviderAudit, [receipt]);
});

test('one explicitly authorized replacement preserves the unknown attempt and cannot reuse the authorization', async () => {
  const f = fixture();
  f.input.record.aiAnalysis = JSON.stringify({ ...JSON.parse(String(f.input.record.aiAnalysis)),
    imageAnalysisQueueState: 'unknown', imageAnalysisStatus: 'unknown', imageAnalysisAttemptId: 'old-attempt',
    imageAnalysisError: 'unknown supplier result' });
  const authorization = { expectedAttemptId: 'old-attempt', authorizedAt: '2026-10-29T01:00:00Z', reason: 'User authorized one replacement' };
  await assert.rejects(reanalyzeStoredImagePost({ ...f.input, replacementAuthorization: { ...authorization, expectedAttemptId: 'different' } }), /authorization_mismatch/);
  assert.deepEqual(f.events, []);
  await reanalyzeStoredImagePost({ ...f.input, replacementAuthorization: authorization });
  const latest = JSON.parse(String(f.row.aiAnalysis));
  assert.equal(latest.imageAnalysisPriorAttempts[0].attemptId, 'old-attempt');
  assert.equal(latest.imageAnalysisPriorAttempts[0].status, 'unknown');
  assert.equal(latest.imageAnalysisPriorAttempts[0].replacementAuthorization.reason, authorization.reason);
  await assert.rejects(reanalyzeStoredImagePost({ ...f.input, record: f.row, replacementAuthorization: authorization }), /authorization_mismatch/);
  assert.equal(f.events.filter(event => event === 'analyze').length, 1);
});

test('a provider rejection with a receipt stays failed rather than unknown', async () => {
  const f = fixture();
  await reanalyzeStoredImagePost({ ...f.input, analyze: async () => ({ status: 'failed',
    error: 'image_post_analysis_model_unavailable', providerAttempted: true, providerRejected: true }) });
  assert.equal(JSON.parse(String(f.row.aiAnalysis)).imageAnalysisQueueState, 'failed');
});

test('selected evidence updates the correct carousel image and preserves other completed images', async () => {
  const f = fixture();
  f.input.record.aiAnalysis = JSON.stringify({ ...JSON.parse(String(f.input.record.aiAnalysis)),
    imageUrls: [0,1,2,3].map(index => `/api/overseas/videos/record-1/image/${index}`),
    imageEvidence: { ...evidence, productionLabels: [{ imageIndex: 1, evidence: 'existing first image' }] } });
  await reanalyzeStoredImagePost({ ...f.input, imageIndex: 4, analyze: async item => {
    assert.equal(item.analysisImageIndex, 4);
    return { status: 'analyzed', analysis: { ...evidence,
      observedFacts: [{ ...evidence.observedFacts[0], imageIndex: 4 }],
      productionLabels: [{ imageIndex: 4, kind: 'product_only', productPresence: 'present', evidence: 'fourth image',
        confidence: .99, sourceSha256: 'a'.repeat(64), verification: 'unverified' }] } };
  } });
  const saved = JSON.parse(String(f.row.aiAnalysis)).imageEvidence;
  assert.deepEqual(saved.observedFacts.map((item: {imageIndex:number}) => item.imageIndex), [1,4]);
  assert.deepEqual(saved.productionLabels.map((item: {imageIndex:number}) => item.imageIndex), [1,4]);
  assert.equal(saved.productionLabels[0].evidence, 'existing first image');
  const invalid = fixture();
  await assert.rejects(reanalyzeStoredImagePost({ ...invalid.input, imageIndex: 4 }), /selection_invalid/);
  assert.deepEqual(invalid.events, []);
});
