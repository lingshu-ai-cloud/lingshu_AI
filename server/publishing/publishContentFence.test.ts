import assert from 'node:assert/strict';
import { MemoryAtomicStore } from '../testing/memoryAtomicStore.js';
import {
  durablePostContentFenceKeys,
  releaseSpecificPostContentFences,
  type PublishContentFenceRecord,
} from './publishContentFence.js';
import type { PostRecord } from './waLink.js';

function post(status: string, fenceKey: string): PostRecord {
  return {
    id: 'post-1',
    tenant_id: 'tenant-1',
    content_id: 'content-1',
    platform: 'tiktok',
    track_code: 'V1000',
    title: 'Post',
    stats: { status, publishContentFenceKeys: [fenceKey] },
  };
}

const fenceKey = 'f'.repeat(64);
assert.deepEqual(durablePostContentFenceKeys(post('scheduled', fenceKey), true), [fenceKey]);
for (const protectedStatus of ['publishing', 'needs_reconciliation', 'published', 'failed', 'partial', 'on_hold']) {
  assert.deepEqual(
    durablePostContentFenceKeys(post(protectedStatus, fenceKey), true),
    [fenceKey],
    `${protectedStatus} must retain its fence when a late calendar mutation cleanup races the worker`,
  );
}
assert.deepEqual(
  durablePostContentFenceKeys(post('cancelled', fenceKey), true),
  [],
  'a cancelled post must not protect stale audit-snapshot fence keys',
);

const store = new MemoryAtomicStore();
await store.create<PublishContentFenceRecord>('publish_content_fences', {
  id: 'fence-1', tenant_id: 'tenant-1', fence_key: fenceKey, platform: 'tiktok', account_id: 'account-1',
  content_digest: 'd'.repeat(64), owner_key: 'calendar-post:post-1', post_id: 'post-1', state: 'active', revision: 1,
  created_at: '2026-09-02T00:00:00.000Z', updated_at: '2026-09-02T00:00:00.000Z',
});

await releaseSpecificPostContentFences(
  store,
  'post-1',
  [fenceKey],
  durablePostContentFenceKeys(post('cancelled', fenceKey), true),
);
const released = await store.getById<PublishContentFenceRecord>('publish_content_fences', 'fence-1');
assert.equal(released?.state, 'released', 'late PATCH cleanup must release a fence after concurrent DELETE wins');
assert.equal(released?.post_id, '');

console.log('publish content fence mutation-race tests passed');
