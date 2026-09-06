import assert from 'node:assert/strict';
import { store } from '../storage/index.js';
import { assertNoUnresolvedPublishing, publishingMutationBlocked } from './pendingPublishGuard.js';
import { publishingRouter } from '../routes/publishing.js';
import type { PostRecord } from './waLink.js';
const original = { list: store.list, getById: store.getById, update: store.update, delete: store.delete };
const post: PostRecord = { id: 'pending-post', tenant_id: 'tenant', platform: 'youtube', track_code: 'V1', content_id: 'content', stats: { status: 'failed', videoPath: '/isolated/video.mp4', targetAccountIds: ['account'], publishResults: { account: { status: 'unknown', attemptId: 'attempt' } } } };
let mutations = 0;
store.list = (async () => ({ items: [post], totalPages: 1, totalItems: 1, page: 1, perPage: 100 })) as typeof store.list;
store.getById = (async () => structuredClone(post)) as typeof store.getById;
store.update = (async () => { mutations++; return true; }) as typeof store.update;
store.delete = (async () => { mutations++; return true; }) as typeof store.delete;
try {
  assert.equal(publishingMutationBlocked(post), true, 'changing parent status cannot erase unresolved receipts');
  const input = { tenantId: 'tenant', platform: 'youtube', accountIds: ['account'], videoPath: 'file:///isolated/video.mp4' };
  await assert.rejects(() => assertNoUnresolvedPublishing(input), /禁止重复/);
  await assert.rejects(() => assertNoUnresolvedPublishing({ ...input, currentPostId: post.id, currentAttemptId: 'attempt' }), /禁止重复/, 'even a matching token cannot resend an unknown outcome');
  await assertNoUnresolvedPublishing({ ...input, tenantId: 'other' });
  await assertNoUnresolvedPublishing({ ...input, accountIds: ['other'] });
  (post.stats!.publishResults as any).account.status = 'in_flight';
  await assertNoUnresolvedPublishing({ ...input, currentPostId: post.id, currentAttemptId: 'attempt' });
  await assert.rejects(() => assertNoUnresolvedPublishing({ ...input, currentPostId: post.id, currentAttemptId: 'forged' }), /禁止重复/);
  for (const [method, route] of [['patch', '/calendar/:id'], ['delete', '/calendar/:id'], ['post', '/calendar/:id/retry']]) {
    const layer = (publishingRouter as any).stack.find((entry: any) => entry.route?.path === route && entry.route.methods[method]);
    let status = 200;
    const res = { locals: { tenantId: 'tenant' }, status(code: number) { status = code; return this; }, json() { return this; } };
    await layer.route.stack.at(-1).handle({ params: { id: post.id }, body: { scheduledAt: new Date().toISOString(), status: 'scheduled', publishResults: {} } }, res);
    assert.equal(status, 409, `${method} ${route} cannot reset an unresolved attempt`);
  }
  assert.equal(mutations, 0);
} finally { Object.assign(store, original); }
console.log('pending publishing mutation and manual resubmission guard passed');
