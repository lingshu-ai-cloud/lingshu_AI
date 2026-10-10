import assert from 'node:assert/strict';
import { checkBullMq, redisConnectionOptions, selectedQueueBackend } from './bullmq.js';

assert.equal(selectedQueueBackend({}), 'local');
assert.equal(selectedQueueBackend({ QUEUE_BACKEND: 'bullmq' }), 'bullmq');
assert.throws(() => selectedQueueBackend({ QUEUE_BACKEND: 'memory' }), /Unsupported QUEUE_BACKEND/);
assert.throws(() => redisConnectionOptions({}), /REDIS_URL is required/);
assert.throws(() => redisConnectionOptions({ REDIS_URL: 'https://redis.example' }), /redis:\/\/ or rediss:\/\//);
const tls = redisConnectionOptions({ REDIS_URL: 'rediss://user:secret@redis.example:6380/2' }) as { url?: string; tls?: unknown; maxRetriesPerRequest?: number | null };
assert.equal(tls.url, 'rediss://user:secret@redis.example:6380/2');
assert.deepEqual(tls.tls, {});
assert.equal(tls.maxRetriesPerRequest, null);

console.log('BullMQ configuration contract passed');

assert.throws(() => selectedQueueBackend({ NODE_ENV: 'production' }), /local queue fallback is disabled/);
assert.throws(() => selectedQueueBackend({ NODE_ENV: 'production', QUEUE_BACKEND: 'local' }), /local queue fallback is disabled/);
assert.equal(selectedQueueBackend({ NODE_ENV: 'production', QUEUE_BACKEND: 'bullmq' }), 'bullmq');
assert.equal(selectedQueueBackend({ NODE_ENV: 'test', QUEUE_BACKEND: 'local' }), 'local');
assert.throws(() => redisConnectionOptions({ REDIS_URL: 'redis://user:secret@[invalid' }), error => error instanceof Error && error.message === 'REDIS_URL must be a valid Redis URL' && !error.message.includes('secret'));
assert.throws(() => redisConnectionOptions({ REDIS_URL: 'redis://localhost/not-a-db' }), /optional numeric database/);
assert.throws(() => redisConnectionOptions({ REDIS_URL: 'redis://localhost/0#secret' }), /optional numeric database/);
assert.throws(() => selectedQueueBackend({ QUEUE_BACKEND: 'secret-token' }), error => error instanceof Error && !error.message.includes('secret-token'));

const previousBackend = process.env.QUEUE_BACKEND;
try {
  process.env.QUEUE_BACKEND = 'bullmq';
  let probes = 0;
  await checkBullMq({ timeoutMs: 50, probe: async () => { probes++; } });
  assert.equal(probes, 1);
  await assert.rejects(checkBullMq({ timeoutMs: 10, probe: () => new Promise(() => {}) }), /BullMQ health check failed or timed out/);
  await assert.rejects(checkBullMq({ probe: async () => { throw new Error('redis://user:secret@host'); } }), error => error instanceof Error && !error.message.includes('secret'));
} finally {
  if (previousBackend === undefined) delete process.env.QUEUE_BACKEND;
  else process.env.QUEUE_BACKEND = previousBackend;
}
