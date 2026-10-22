import assert from 'node:assert/strict';
import test from 'node:test';
import { projectVideoPipelineStats } from './videoPipelineStatsProjection.js';

const now = Date.parse('2026-10-23T12:00:00.000Z');

function stats(visibleRecords: Record<string, unknown>[], analysisQueueRecords = visibleRecords) {
  return projectVideoPipelineStats({
    visibleRecords,
    analysisQueueRecords,
    opsStats: { total: 2, byStatus: { pending: 2 } },
    geminiConfigured: false,
    qwenConfigured: true,
    nowMs: now,
  }) as Record<string, any>;
}

test('pipeline summary counts only supplied visible records and preserves operational snapshot', () => {
  const visible = {
    id: 'visible', platform: 'youtube', status: 'analyzing', crawledAt: '2026-10-23T08:00:00.000Z',
    aiAnalysis: JSON.stringify({ downloadStatus: 'ops_processing', geminiStatus: 'analyzing', requestedAnalysisMode: 'exact' }),
  };
  const hiddenQueued = {
    id: 'hidden-queue', platform: 'tiktok', status: 'queued', crawledAt: '2026-10-22T08:00:00.000Z',
    aiAnalysis: JSON.stringify({ geminiStatus: 'paused', analysisPausedAt: '2026-10-23T01:00:00.000Z', userVisible: false }),
  };
  const result = stats([visible], [visible, hiddenQueued]);
  assert.equal(result.updatedAt, '2026-10-23T12:00:00.000Z');
  assert.deepEqual(result.crawl.byPlatform, { youtube: 1 });
  assert.equal(result.crawl.today, 1);
  assert.equal(result.crawl.last24h, 1);
  assert.equal(result.fetchQueue.queued, 1);
  assert.deepEqual(result.fetchQueue.ops, { total: 2, byStatus: { pending: 2 } });
  assert.equal(result.analysisQueue.pendingRecords, 2);
  assert.deepEqual(result.analysisQueue.byStatus, { analyzing: 1, paused: 1 });
  assert.equal(result.analysisQueue.items[0].thumbnailUrl, '/api/overseas/videos/visible/thumbnail');
  assert.equal(result.analysisQueue.items[1].visibility, 'hidden');
  assert.equal(result.analysisQueue.providerStatus.gemini.configured, false);
  assert.equal(result.analysisQueue.providerStatus.qwen.configured, true);
});

test('pipeline queue status gives cancellation and pause precedence over stale errors', () => {
  const cancelled = { id: 'cancelled', status: 'failed', aiAnalysis: JSON.stringify({ analysisQueueState: 'cancelled', analysisCancelledAt: '2026-10-23T01:00:00.000Z', analysisError: 'old error' }) };
  const paused = { id: 'paused', status: 'failed', aiAnalysis: JSON.stringify({ geminiStatus: 'paused', analysisError: 'old error' }) };
  const failed = { id: 'failed', status: 'failed', aiAnalysis: JSON.stringify({ analysisError: 'token=secret timeout' }) };
  const result = stats([cancelled, paused, failed]);
  assert.deepEqual(result.analysisQueue.items.map((item: { status: string }) => item.status), ['cancelled', 'paused', 'failed']);
  assert.equal(result.analysisQueue.failedRecords, 1);
  assert.equal(result.analysisQueue.items[2].error.includes('secret'), false);
});

test('refinement list sorts by queued time and keeps only first fifty records', () => {
  const records = Array.from({ length: 55 }, (_, index) => ({
    id: `video-${index}`, platform: 'youtube',
    aiAnalysis: JSON.stringify({ refinementQueuedAt: new Date(now - index * 1000).toISOString(), refinementStatus: 'queued' }),
  }));
  const result = stats(records);
  assert.equal(result.analysisQueue.refinementItems.length, 50);
  assert.equal(result.analysisQueue.refinementItems[0].id, 'video-0');
  assert.equal(result.analysisQueue.refinementItems[49].id, 'video-49');
});
