import test from 'node:test';
import assert from 'node:assert/strict';
import { probeWeeklyProductionEnvironment } from './weeklyProductionEnvironmentProbe.js';

test('configured queue cannot become ready when its actual connection fails; errors are redacted', async () => {
  const report = await probeWeeklyProductionEnvironment({
    env: { QUEUE_BACKEND: 'bullmq', REDIS_URL: 'redis://configured' },
    atomicStore: async () => { throw Error('postgres://user:secret@host'); },
    queue: async () => { throw Error('redis://user:secret@host'); },
  });
  assert.equal(report.ready, false);
  assert.equal(report.checks.find(check => check.key === 'atomic_publication_lease')?.ready, false);
  assert.equal(report.checks.find(check => check.key === 'durable_worker_queue_connection')?.ready, false);
  assert.doesNotMatch(JSON.stringify(report), /secret|user:|@host/);
});

test('local queue no-op is not evidence of a durable production connection', async () => {
  const report = await probeWeeklyProductionEnvironment({ env: {}, atomicStore: () => true, queue: async () => {} });
  assert.equal(report.checks.find(check => check.key === 'durable_worker_queue_connection')?.ready, false);
});

test('unresponsive infrastructure probes terminate with stable blockers', async () => {
  const report = await probeWeeklyProductionEnvironment({ env: { QUEUE_BACKEND: 'bullmq' }, timeoutMs: 5,
    atomicStore: () => new Promise<boolean>(() => {}), queue: () => new Promise<void>(() => {}) });
  assert.equal(report.ready, false);
  assert.equal(report.checks.find(check => check.key === 'durable_worker_queue_connection')?.reason, 'durable_worker_queue_unavailable');
});
