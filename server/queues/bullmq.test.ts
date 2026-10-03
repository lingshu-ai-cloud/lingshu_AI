import assert from 'node:assert/strict';
import { redisConnectionOptions, selectedQueueBackend } from './bullmq.js';

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
