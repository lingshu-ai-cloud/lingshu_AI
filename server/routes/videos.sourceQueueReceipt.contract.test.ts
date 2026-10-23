import { readVideoApplicationSources, videoApplicationFunction } from '../../tests/fixtures/videoApplicationSources.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { store } from '../storage/index.js';
import { queueAnalyzeSource } from './videos.js';

const source = readVideoApplicationSources();
const queueFunction = videoApplicationFunction(source, 'queueAnalyzeSource');

test('source analysis persists a real crawler receipt and terminalizes enqueue failures', () => {
  assert.match(queueFunction, /async function queueAnalyzeSource\(/, 'the shared queue implementation must remain discoverable');
  assert.match(queueFunction, /if \(!queuedRecord\) throw new Error\('source_analysis_queue_marker_persist_failed'\)/);
  assert.match(queueFunction, /opsTask\s*=\s*enqueueCrawlerOpsTask\(/);
  assert.match(queueFunction, /sourceAnalysisQueueReceiptPatch\(opsTask, acceptedAt\)/);
  assert.match(queueFunction, /if \(!receiptRecord\) throw new Error\('source_analysis_queue_receipt_persist_failed'\)/);
  assert.match(queueFunction, /updateCrawlerOpsTask\(opsTask\.id,\s*\{\s*status:\s*'failed'/);
  assert.match(queueFunction, /sourceAnalysisQueueFailurePatch\(compactError/);
  assert.match(queueFunction, /if \(!failureRecord\) throw new Error\('source_analysis_queue_failure_persist_failed'\)/);
  assert.match(queueFunction, /throw error;/);
});

test('source analysis treats a false queue-marker update as a persistence failure', async () => {
  const originalUpdate = store.update;
  let updateCalls = 0;
  store.update = (async () => {
    updateCalls += 1;
    return false;
  }) as typeof store.update;
  try {
    await assert.rejects(queueAnalyzeSource({
      id: 'source-update-false',
      tenantId: 'tenant-test',
      platform: 'youtube',
      sourceUrl: 'https://www.youtube.com/watch?v=source-update-false',
      title: 'Source update false',
      aiAnalysis: JSON.stringify({ requestedAnalysisMode: 'exact', analysisRunId: 'run-update-false' }),
    }), /source_analysis_queue_marker_persist_failed/);
    assert.equal(updateCalls, 1, 'a missing record must fail before any crawler task is enqueued');
  } finally {
    store.update = originalUpdate;
  }
});
