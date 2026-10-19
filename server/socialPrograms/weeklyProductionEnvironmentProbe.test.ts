import test from 'node:test';
import assert from 'node:assert/strict';
import { probeContentWorkerHeartbeat, probeWeeklyProductionEnvironment } from './weeklyProductionEnvironmentProbe.js';
import type { DataStore } from '../storage/datastore.js';

const heartbeatStore = (items: Record<string, unknown>[]) => ({
  list: async () => ({ items, totalItems: items.length, totalPages: 1, page: 1, perPage: 20 }),
}) as unknown as DataStore;

test('content worker heartbeat requires a fresh ready worker from the exact build', async () => {
  const sha = 'a'.repeat(40);
  const now = new Date('2026-10-20T00:01:00.000Z');
  assert.equal(await probeContentWorkerHeartbeat({ dataStore: heartbeatStore([
    { role: 'worker', state: 'ready', last_seen_at: '2026-10-20T00:00:30.000Z', details: { build: { commitSha: sha } } },
  ]), expectedBuildSha: sha, now }), true);
  for (const row of [
    { role: 'web', state: 'ready', last_seen_at: '2026-10-20T00:00:30.000Z', details: { build: { commitSha: sha } } },
    { role: 'worker', state: 'ready', last_seen_at: '2026-10-19T23:00:00.000Z', details: { build: { commitSha: sha } } },
    { role: 'worker', state: 'ready', last_seen_at: '2026-10-20T00:00:30.000Z', details: { build: { commitSha: 'b'.repeat(40) } } },
  ]) assert.equal(await probeContentWorkerHeartbeat({ dataStore: heartbeatStore([row]), expectedBuildSha: sha, now }), false);
  assert.equal(await probeContentWorkerHeartbeat({ dataStore: heartbeatStore([]), expectedBuildSha: 'unknown', now }), false);
});

test('configured queue cannot become ready when its actual connection fails; errors are redacted', async () => {
  const report = await probeWeeklyProductionEnvironment({
    env: { QUEUE_BACKEND: 'bullmq', REDIS_URL: 'redis://configured' },
    atomicStore: async () => { throw Error('postgres://user:secret@host'); },
    contentOrderAtomicStore: async () => { throw Error('postgres://user:secret@host'); },
    queue: async () => { throw Error('redis://user:secret@host'); },
  });
  assert.equal(report.ready, false);
  assert.equal(report.checks.find(check => check.key === 'atomic_publication_lease')?.ready, false);
  assert.equal(report.checks.find(check => check.key === 'content_order_atomic_store')?.ready, false);
  assert.equal(report.checks.find(check => check.key === 'durable_worker_queue_connection')?.ready, false);
  assert.doesNotMatch(JSON.stringify(report), /secret|user:|@host/);
});

test('local queue no-op is not evidence of a durable production connection', async () => {
  const report = await probeWeeklyProductionEnvironment({ env: {}, atomicStore: () => true, contentOrderAtomicStore: () => true, queue: async () => {} });
  assert.equal(report.checks.find(check => check.key === 'durable_worker_queue_connection')?.ready, false);
});

test('configuration and connections cannot substitute for runtime production evidence', async () => {
  const report = await probeWeeklyProductionEnvironment({
    env: { QUEUE_BACKEND: 'bullmq', REDIS_URL: 'redis://configured' },
    atomicStore: () => true,
    contentOrderAtomicStore: () => true,
    queue: async () => {},
  });
  assert.equal(report.ready, false);
  assert.deepEqual(
    report.checks.filter(check => ['langgraph_checkpoint_store', 'content_worker_heartbeat', 'web_to_worker_job_claim'].includes(check.key)).map(check => check.reason),
    ['langgraph_checkpoint_store_unverified', 'content_worker_heartbeat_unverified', 'web_to_worker_job_claim_unverified'],
  );
});

test('runtime checks require each independent probe to succeed and redact failures', async () => {
  const report = await probeWeeklyProductionEnvironment({
    env: { QUEUE_BACKEND: 'bullmq', REDIS_URL: 'redis://configured' },
    atomicStore: () => true,
    contentOrderAtomicStore: () => true,
    queue: async () => {},
    langgraphCheckpointStore: async () => true,
    contentWorkerHeartbeat: async () => { throw Error('secret heartbeat row'); },
    webToWorkerJobClaim: async () => true,
  });
  assert.equal(report.checks.find(check => check.key === 'langgraph_checkpoint_store')?.ready, true);
  assert.equal(report.checks.find(check => check.key === 'content_worker_heartbeat')?.ready, false);
  assert.equal(report.checks.find(check => check.key === 'web_to_worker_job_claim')?.ready, true);
  assert.doesNotMatch(JSON.stringify(report), /secret heartbeat/);
});

test('unresponsive infrastructure probes terminate with stable blockers', async () => {
  const report = await probeWeeklyProductionEnvironment({ env: { QUEUE_BACKEND: 'bullmq' }, timeoutMs: 5,
    atomicStore: () => new Promise<boolean>(() => {}), contentOrderAtomicStore: () => new Promise<boolean>(() => {}), queue: () => new Promise<void>(() => {}),
    langgraphCheckpointStore: () => new Promise<boolean>(() => {}), contentWorkerHeartbeat: () => new Promise<boolean>(() => {}), webToWorkerJobClaim: () => new Promise<boolean>(() => {}) });
  assert.equal(report.ready, false);
  assert.equal(report.checks.find(check => check.key === 'durable_worker_queue_connection')?.reason, 'durable_worker_queue_unavailable');
});
