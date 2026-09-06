import assert from 'node:assert/strict';
import { store } from '../storage/index.js';
import { recoverPublishingReceipt, type PublishingReceiptEvidence } from './receiptRecovery.js';
import type { PostRecord } from './waLink.js';
const original = { getById: store.getById, update: store.update };
const startedAt = '2026-09-06T01:00:00.000Z';
let post: PostRecord = { id: 'post', tenant_id: 'tenant', platform: 'youtube', track_code: 'V1234', wa_link: 'https://wa.me/15551234567?text=unique-V1234', stats: { status: 'needs_attention', targetAccountIds: ['account'], approvedVersion: 4, publishResults: { account: { status: 'unknown', attemptId: 'attempt', startedAt } } } };
store.getById = (async (collection: string, id: string) => collection === 'posts' && id === post.id ? structuredClone(post) : null) as typeof store.getById;
store.update = (async (_collection: string, _id: string, patch: Record<string, unknown>) => { Object.assign(post, structuredClone(patch)); return true; }) as typeof store.update;
const input = { tenantId: 'tenant', postId: 'post', accountId: 'account', attemptId: 'attempt', platformPostId: 'youtube-id' };
const evidence: PublishingReceiptEvidence = { id: 'youtube-id', channelId: 'owner', ownedChannelIds: ['owner'], description: post.wa_link!, publishedAt: startedAt, privacyStatus: 'public' };
try {
  await assert.rejects(() => recoverPublishingReceipt({ ...input, tenantId: 'other' }, async () => evidence), /不存在/);
  await assert.rejects(() => recoverPublishingReceipt({ ...input, attemptId: 'old' }, async () => evidence), /已变化/);
  for (const bad of [{ channelId: 'other' }, { description: 'same title, no tracking link' }, { publishedAt: '2020-01-01' }, { privacyStatus: 'private' }, { id: 'other' }]) {
    await assert.rejects(() => recoverPublishingReceipt(input, async () => ({ ...evidence, ...bad })), /不匹配/);
    assert.equal(post.stats?.status, 'needs_attention');
  }
  await assert.rejects(() => recoverPublishingReceipt(input, async () => { throw new Error('provider unavailable'); }), /provider unavailable/);
  let lookups = 0;
  await recoverPublishingReceipt(input, async () => { lookups++; return evidence; });
  assert.equal(post.stats?.status, 'finalize_pending');
  assert.equal(post.stats?.approvedVersion, 4);
  await recoverPublishingReceipt(input, async () => { throw new Error('must not duplicate reconciliation'); });
  assert.equal(lookups, 1);
} finally { Object.assign(store, original); }
console.log('publishing receipt recovery passed');
