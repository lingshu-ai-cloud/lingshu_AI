import assert from 'node:assert/strict';
import { canonicalScheduledCollectionRecords, evaluateScheduledDiscoveryRuns, mustReobserveSucceededCollection } from './scheduledCollectionProof.js';

assert.equal(mustReobserveSucceededCollection('scheduled_source_collection', 'succeeded'), true);
assert.equal(mustReobserveSucceededCollection('viral_analysis', 'succeeded'), false);
assert.equal(mustReobserveSucceededCollection('scheduled_source_collection', 'waiting_external'), false);

const canonical = canonicalScheduledCollectionRecords([
  { id: 'mirror-1', task_id: 'task-a', updated_at: '2026-10-11T01:00:00Z' },
  { id: 'mirror-2', task_id: 'task-a', updated_at: '2026-10-11T02:00:00Z' },
  { id: 'mirror-3', task_id: 'task-a', updated_at: '2026-10-11T03:00:00Z' },
]);
assert.equal(canonical.length, 1);
assert.equal(canonical[0].id, 'mirror-3');

const failed = evaluateScheduledDiscoveryRuns([{
  id: 'run-1', discoveryScopeId: 'scope-1', status: 'failed', stopReason: 'source_failed',
  error: 'TikTok keyword search returned no usable videos', modeStats: { momentum: { accepted: 0 } },
  platformStats: { tiktok: { failed: 5 }, youtube: { failed: 2 } }, finishedAt: '2026-10-11T02:39:34Z',
}], ['scope-1']);
assert.equal(failed.ready, false);
assert.equal(failed.usable, 0);
assert.match(failed.blockedReason, /平台采集失败/);
assert.match(failed.blockedReason, /tiktok、youtube/);
assert.match(failed.blockedReason, /0 条可用内容/);

const empty = evaluateScheduledDiscoveryRuns([{
  id: 'run-2', discoveryScopeId: 'scope-1', status: 'completed', modeStats: { momentum: { accepted: 0 } },
}], ['scope-1']);
assert.equal(empty.ready, false);
assert.match(empty.blockedReason, /0 条可用内容/);

const usable = evaluateScheduledDiscoveryRuns([{
  id: 'run-3', discoveryScopeId: 'scope-1', status: 'completed', modeStats: { momentum: { accepted: 2 }, innovation: { accepted: 1 } },
}], ['scope-1']);
assert.equal(usable.ready, true);
assert.equal(usable.usable, 3);

console.log('scheduled collection proof tests passed');
