import assert from 'node:assert/strict';
import { publishQueueProjection, withPublishQueueProjection } from './publishQueueProjection.js';

const base = {
  id: 'post-1', tenant_id: 'tenant-1', platform: 'youtube', track_code: 'V1000',
  published_at: '2026-09-03T00:00:00.000Z', reconciliation_required: false,
};
const admitted = { source: 'manual', schedulePayloadHash: 'a'.repeat(64) };

assert.deepEqual(publishQueueProjection({ ...base, stats: { ...admitted, status: 'scheduled' } }), {
  publish_queue_state: 'pending', publish_available_at: '2026-09-03T00:00:00.000Z',
});
assert.deepEqual(publishQueueProjection({
  ...base,
  publish_lease_owner: 'worker-1',
  publish_lease_expires_at: '2026-09-03T00:15:00.000Z',
  stats: { ...admitted, status: 'scheduled' },
}), { publish_queue_state: 'pending', publish_available_at: '2026-09-03T00:15:00.000Z' }, 'a scheduled lease later than the slot defers admission');
assert.deepEqual(publishQueueProjection({
  ...base,
  publish_lease_owner: 'worker-1',
  publish_lease_expires_at: '2026-09-02T23:55:00.000Z',
  stats: { ...admitted, status: 'scheduled' },
}), { publish_queue_state: 'pending', publish_available_at: '2026-09-03T00:00:00.000Z' }, 'an old lease never moves a future scheduled slot earlier');
assert.deepEqual(publishQueueProjection({
  ...base,
  stats: { ...admitted, status: 'failed', publishAttempts: 2, nextPublishAttemptAt: '2026-09-03T00:05:00Z' },
}), { publish_queue_state: 'pending', publish_available_at: '2026-09-03T00:05:00.000Z' });
assert.deepEqual(publishQueueProjection({
  ...base,
  stats: { ...admitted, status: 'failed', publishAttempts: 2, nextPublishAttemptAt: '2026-09-02T23:55:00Z' },
}), { publish_queue_state: 'pending', publish_available_at: '2026-09-03T00:00:00.000Z' }, 'retry availability cannot precede the scheduled slot');
assert.deepEqual(publishQueueProjection({ ...base, stats: { ...admitted, status: 'failed', publishAttempts: 2 } }), {
  publish_queue_state: 'terminal', publish_available_at: '',
}, 'a failed row without a durable retry deadline is not queue work');
assert.deepEqual(publishQueueProjection({ ...base, stats: { ...admitted, status: 'failed', publishAttempts: 3 } }), {
  publish_queue_state: 'terminal', publish_available_at: '',
});

assert.deepEqual(publishQueueProjection({
  ...base,
  publish_lease_expires_at: '2026-09-03T00:20:00.000Z',
  stats: { ...admitted, status: 'publishing', lastPublishAttemptAt: '2026-09-03T00:02:00.000Z' },
}), { publish_queue_state: 'pending', publish_available_at: '2026-09-03T00:20:00.000Z' }, 'scheduled publishing uses the latest schedule, stale-lock, and lease deadline');
assert.deepEqual(publishQueueProjection({
  ...base,
  publish_lease_expires_at: '2026-09-03T00:10:00.000Z',
  stats: { ...admitted, status: 'publishing', lastPublishAttemptAt: '2026-09-03T00:02:00.000Z' },
}), { publish_queue_state: 'pending', publish_available_at: '2026-09-03T00:17:00.000Z' }, 'the stale-lock deadline wins when it is later than the lease');
assert.deepEqual(publishQueueProjection({
  ...base,
  publish_lease_expires_at: '2026-09-03T00:20:00.000Z',
  stats: { ...admitted, status: 'publishing' },
}), { publish_queue_state: 'blocked', publish_available_at: '' }, 'scheduled publishing without last-attempt evidence cannot be recovered');

assert.deepEqual(publishQueueProjection({
  ...base,
  published_at: '',
  publish_lease_expires_at: '',
  stats: { status: 'publishing', directPublish: true, lastPublishAttemptAt: '2026-09-03T00:00:00.000Z' },
}), { publish_queue_state: 'direct', publish_available_at: '2026-09-03T00:15:00.000Z' }, 'legacy direct publishing can use a valid stale-lock deadline without a lease');
assert.deepEqual(publishQueueProjection({
  ...base,
  published_at: '',
  publish_lease_expires_at: '2026-09-03T00:20:00.000Z',
  stats: { status: 'publishing', directPublish: true, lastPublishAttemptAt: '2026-09-03T00:00:00.000Z' },
}), { publish_queue_state: 'direct', publish_available_at: '2026-09-03T00:20:00.000Z' }, 'direct publishing conservatively uses its latest valid deadline');
assert.deepEqual(publishQueueProjection({
  ...base,
  published_at: '',
  publish_lease_expires_at: '',
  stats: { status: 'publishing', directPublish: true },
}), { publish_queue_state: 'blocked', publish_available_at: '' }, 'direct publishing with no timing evidence remains blocked');

assert.deepEqual(publishQueueProjection({ ...base, stats: { status: 'scheduled' } }), {
  publish_queue_state: 'blocked', publish_available_at: '',
}, 'missing source/hash admission evidence cannot enter the indexed queue');
assert.deepEqual(publishQueueProjection({ ...base, platform_post_id: 'remote-1', stats: { ...admitted, status: 'scheduled' } }), {
  publish_queue_state: 'terminal', publish_available_at: '',
}, 'a final platform ID is terminal even if nested status drifted');
assert.deepEqual(publishQueueProjection({
  ...base, reconciliation_required: true, stats: { ...admitted, status: 'publishing' },
}), { publish_queue_state: 'blocked', publish_available_at: '' });
assert.deepEqual(withPublishQueueProjection(
  { ...base, stats: { ...admitted, status: 'publishing', lastPublishAttemptAt: '2026-09-03T00:00:00Z' }, publish_lease_expires_at: '2026-09-03T00:15:00Z' },
  { stats: { status: 'published' }, publish_lease_expires_at: '' },
), {
  stats: { status: 'published' }, publish_lease_expires_at: '',
  publish_queue_state: 'terminal', publish_available_at: '',
});

console.log('publish queue projection tests passed');
