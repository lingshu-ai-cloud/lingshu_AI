import assert from 'node:assert/strict';
import {
  canonicalScheduledCollectionRecords,
  evaluateScheduledDiscoveryRuns,
  mustReobserveSucceededCollection,
  scheduledCollectionFailureCanRetry,
  shouldRunScheduledCollection,
} from './scheduledCollectionProof.js';

assert.equal(mustReobserveSucceededCollection('scheduled_source_collection', 'succeeded'), true);
assert.equal(mustReobserveSucceededCollection('viral_analysis', 'succeeded'), false);
assert.equal(mustReobserveSucceededCollection('scheduled_source_collection', 'waiting_external'), false);

const now = Date.parse('2026-10-14T10:00:00Z');
assert.equal(shouldRunScheduledCollection({ enabled: true, created: true, updated: false, executionState: 'idle', now }), true);
assert.equal(shouldRunScheduledCollection({ enabled: true, created: false, updated: false, lastRun: '2026-10-14T09:00:00Z', executionState: 'failed', retryAt: '2026-10-14T09:59:00Z', now }), true);
assert.equal(shouldRunScheduledCollection({ enabled: true, created: false, updated: false, lastRun: '2026-10-14T09:00:00Z', executionState: 'failed', retryAt: '2026-10-14T10:05:00Z', now }), false);
assert.equal(shouldRunScheduledCollection({ enabled: true, created: false, updated: false, lastRun: '2026-10-14T09:00:00Z', executionState: 'succeeded', rerunRequestedAt: '2026-10-14T09:01:00Z', now }), true);
assert.equal(scheduledCollectionFailureCanRetry(new Error('network timeout')), true);
assert.equal(scheduledCollectionFailureCanRetry(new Error('401 credential expired')), false);

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
assert.equal(failed.state, 'failed');
assert.equal(failed.usable, 0);
assert.match(failed.blockedReason, /平台采集失败/);
assert.match(failed.blockedReason, /tiktok、youtube/);
assert.match(failed.blockedReason, /0 条可用内容/);

const empty = evaluateScheduledDiscoveryRuns([{
  id: 'run-2', discoveryScopeId: 'scope-1', status: 'completed', modeStats: { momentum: { accepted: 0 } },
}], ['scope-1']);
assert.equal(empty.ready, false);
assert.equal(empty.state, 'failed');
assert.match(empty.blockedReason, /0 条可用内容/);

const running = evaluateScheduledDiscoveryRuns([{
  id: 'run-running', discoveryScopeId: 'scope-1', status: 'running', modeStats: { momentum: { accepted: 0 } },
}], ['scope-1']);
assert.equal(running.ready, false);
assert.equal(running.state, 'pending');
assert.match(running.blockedReason, /正在进行/);

const usable = evaluateScheduledDiscoveryRuns([{
  id: 'run-3', discoveryScopeId: 'scope-1', status: 'completed', modeStats: { momentum: { accepted: 2 }, innovation: { accepted: 1 } },
}], ['scope-1']);
assert.equal(usable.ready, true);
assert.equal(usable.state, 'ready');
assert.equal(usable.usable, 3);

console.log('scheduled collection proof tests passed');
