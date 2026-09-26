import { createHash, randomUUID } from 'node:crypto';
import { acquireDurableOperationLease, assertDurableOperationLease, releaseDurableOperationLease, type DurableOperationLease } from '../runtime/durableLease.js';
import { externalEffectLeaseStore } from '../runtime/externalEffectLeaseStore.js';
import { store } from '../storage/index.js';
import type { PostRecord } from './waLink.js';

const SCOPE = 'external-video-approval';
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const object = (value: unknown): Record<string, unknown> => {
  if (typeof value === 'string') { try { return object(JSON.parse(value) as unknown); } catch { return {}; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
};

export class ExternalVideoApprovalConflict extends Error {
  constructor(readonly code: 'external_video_approval_busy' | 'external_video_approval_duplicate' | 'external_video_approval_lock_unavailable') {
    super(code);
    this.name = 'ExternalVideoApprovalConflict';
  }
}

function subject(platform: string, accountId: string, videoSha256: string): string {
  return createHash('sha256').update(JSON.stringify([platform, accountId, videoSha256])).digest('hex');
}

function blocksNewApproval(post: PostRecord): boolean {
  const stats = object(post.stats);
  const results = object(stats.publishResults);
  if (text(post.platform_post_id)) return true;
  if (Object.values(results).some(result => ['in_flight', 'provider_accepted', 'unknown', 'published'].includes(text(object(result).status)))) return true;
  return !['failed', 'rejected', 'cancelled'].includes(text(stats.status));
}

async function assertNoDuplicate(input: {
  tenantId: string;
  platform: string;
  accountIds: string[];
  videoSha256: string;
  currentPostId?: string;
}): Promise<void> {
  for (let page = 1; ; page += 1) {
    const rows = await store.list<PostRecord>('posts', { where: { tenant_id: input.tenantId }, page, perPage: 500 });
    for (const post of rows.items) {
      if (post.id === input.currentPostId || post.tenant_id !== input.tenantId || post.platform !== input.platform) continue;
      const stats = object(post.stats);
      if (stats.origin !== 'authorized_external_video' || stats.videoSha256 !== input.videoSha256) continue;
      const existingAccounts = Array.isArray(stats.targetAccountIds) ? stats.targetAccountIds.map(text) : [];
      if (!existingAccounts.some(id => input.accountIds.includes(id))) continue;
      if (blocksNewApproval(post)) throw new ExternalVideoApprovalConflict('external_video_approval_duplicate');
    }
    if (!rows.items.length || page >= rows.totalPages) return;
  }
}

/** Database-arbitrated serialization shared by all app processes. */
export async function withExternalVideoApprovalUniqueness<T>(input: {
  tenantId: string;
  platform: string;
  accountIds: string[];
  videoSha256: string;
  currentPostId?: string;
}, action: () => Promise<T>): Promise<T> {
  const accountIds = [...new Set(input.accountIds.map(text).filter(Boolean))].sort();
  if (!accountIds.length || !/^[a-f0-9]{64}$/i.test(input.videoSha256)) {
    throw new ExternalVideoApprovalConflict('external_video_approval_lock_unavailable');
  }
  const leases: DurableOperationLease[] = [];
  try {
    for (const accountId of accountIds) {
      let lease: DurableOperationLease | null;
      try {
        lease = await acquireDurableOperationLease({
          dataStore: externalEffectLeaseStore,
          tenantId: input.tenantId,
          scope: SCOPE,
          subjectId: subject(input.platform, accountId, input.videoSha256),
          ownerId: `external-approval:${process.pid}:${randomUUID()}`,
          leaseDurationMs: 5 * 60_000,
        });
      } catch {
        throw new ExternalVideoApprovalConflict('external_video_approval_lock_unavailable');
      }
      if (!lease) throw new ExternalVideoApprovalConflict('external_video_approval_busy');
      leases.push(lease);
    }
    await assertNoDuplicate({ ...input, accountIds });
    for (const lease of leases) await assertDurableOperationLease({ dataStore: externalEffectLeaseStore, lease, minimumRemainingMs: 30_000 });
    return await action();
  } finally {
    for (const lease of leases.reverse()) {
      await releaseDurableOperationLease({ dataStore: externalEffectLeaseStore, lease }).catch(() => undefined);
    }
  }
}
