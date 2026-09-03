import { createHash } from 'node:crypto';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { compareAndSetRecord } from '../digitalEmployees/reliableKernel.js';
import { listAllRecords } from '../storage/pagination.js';
import type { PostRecord } from './waLink.js';

export interface PublishContentFenceRecord extends Record_ {
  tenant_id: string;
  fence_key: string;
  platform: string;
  account_id: string;
  content_digest: string;
  owner_key: string;
  post_id: string;
  state: 'reserved' | 'active' | 'released';
  revision: number;
  created_at: string;
  updated_at: string;
}

export class PublishContentFenceError extends Error {
  readonly statusCode = 409;
  readonly code: string;
  readonly postId: string;

  constructor(code: string, postId = '') {
    super(code);
    this.name = 'PublishContentFenceError';
    this.code = code;
    this.postId = postId;
  }
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch { return {}; }
  }
  return {};
}

/**
 * Fence keys retained after a failed calendar mutation. When a concurrent
 * cancel wins, the post is no longer executable even if its audit snapshot
 * still contains the former keys, so none of them may be protected.
 */
export function durablePostContentFenceKeys(post: PostRecord, requireExecutable = false): string[] {
  const stats = jsonObject(post.stats);
  // A failed mutation may race the scheduler after it has already advanced the
  // same durable post beyond `scheduled`. Every state that can still represent
  // an executable, published, or unresolved provider outcome must retain its
  // fence; only closed states such as cancelled/voided may release it.
  if (requireExecutable && !postProtectsContentFence(post)) return [];
  return Array.isArray(stats.publishContentFenceKeys)
    ? stats.publishContentFenceKeys.map(String).map(value => value.trim()).filter(Boolean)
    : [];
}

export function approvedUrlContentDigest(approvedVideoUrl: string): string {
  return createHash('sha256').update(`approved-url:v1\0${approvedVideoUrl}`).digest('hex');
}

export function publishContentFenceKey(input: {
  tenantId: string;
  platform: string;
  accountId: string;
  contentDigest: string;
}): string {
  return createHash('sha256').update(JSON.stringify({
    version: 1,
    tenantId: input.tenantId.trim(),
    platform: input.platform.trim().toLowerCase(),
    accountId: input.accountId.trim(),
    contentDigest: input.contentDigest.trim().toLowerCase(),
  })).digest('hex');
}

export function postProtectsContentFence(post: PostRecord, accountId = ''): boolean {
  const stats = jsonObject(post.stats);
  const resultMap = stats.publishResults && typeof stats.publishResults === 'object' && !Array.isArray(stats.publishResults)
    ? stats.publishResults as Record<string, unknown>
    : {};
  const accountResult = accountId ? jsonObject(resultMap[accountId]) : {};
  if (accountId && Object.prototype.hasOwnProperty.call(resultMap, accountId)) {
    if (accountResult.status === 'published') return true;
  } else if (String(post.platform_post_id || '').trim()
    || Object.values(resultMap).some(value => jsonObject(value).status === 'published')) return true;
  return ['scheduled', 'publishing', 'needs_reconciliation', 'published', 'failed', 'partial', 'on_hold']
    .includes(String(stats.status || ''));
}

export function publishContentReservationLeaseMs(): number {
  const configured = Number(process.env.PUBLISH_CONTENT_RESERVATION_LEASE_MS ?? 30 * 60_000);
  return Number.isFinite(configured)
    ? Math.max(5 * 60_000, Math.min(24 * 60 * 60_000, configured))
    : 30 * 60_000;
}

function reservationExpired(record: PublishContentFenceRecord, now = Date.now()): boolean {
  const touchedAt = Date.parse(record.updated_at || record.created_at || '');
  return Number.isFinite(touchedAt) && touchedAt + publishContentReservationLeaseMs() <= now;
}

export type ReservedPublishContentFences = {
  records: PublishContentFenceRecord[];
  linkedPosts: PostRecord[];
  createdIds: string[];
};

export async function reservePublishContentFences(input: {
  dataStore: DataStore;
  tenantId: string;
  platform: string;
  accountIds: string[];
  contentDigest: string;
  ownerKey: string;
  allowFailedDirectReuse?: boolean;
}): Promise<ReservedPublishContentFences> {
  const accountIds = Array.from(new Set(input.accountIds.map(value => value.trim()).filter(Boolean))).sort();
  if (!accountIds.length) throw new PublishContentFenceError('publish_content_fence_account_required');
  if (!/^[a-f0-9]{64}$/.test(input.contentDigest)) throw new PublishContentFenceError('publish_content_digest_invalid');
  const records: PublishContentFenceRecord[] = [];
  const linkedPosts: PostRecord[] = [];
  const createdIds: string[] = [];
  const now = new Date().toISOString();
  try {
    for (const accountId of accountIds) {
      const fenceKey = publishContentFenceKey({
        tenantId: input.tenantId,
        platform: input.platform,
        accountId,
        contentDigest: input.contentDigest,
      });
      const result = await input.dataStore.createIfAbsent<PublishContentFenceRecord>(
        'publish_content_fences',
        { fence_key: fenceKey },
        {
          tenant_id: input.tenantId,
          fence_key: fenceKey,
          platform: input.platform,
          account_id: accountId,
          content_digest: input.contentDigest,
          owner_key: input.ownerKey,
          post_id: '',
          state: 'reserved',
          revision: 0,
          created_at: now,
          updated_at: now,
        },
      );
      let record = result.record;
      if (result.created) createdIds.push(record.id);
      if (record.tenant_id !== input.tenantId || record.platform !== input.platform
        || record.account_id !== accountId || record.content_digest !== input.contentDigest) {
        throw new PublishContentFenceError('publish_content_fence_binding_conflict', record.post_id);
      }
      if (!result.created && record.state === 'released') {
        const reclaimed = await compareAndSetRecord<PublishContentFenceRecord>({
          store: input.dataStore,
          collection: 'publish_content_fences',
          id: record.id,
          expected: { state: 'released', revision: Number(record.revision || 0), post_id: record.post_id || '' },
          patch: {
            state: 'reserved', owner_key: input.ownerKey, post_id: '',
            revision: Number(record.revision || 0) + 1, updated_at: now,
          },
        });
        if (!reclaimed.ok) throw new PublishContentFenceError('publish_content_fence_reservation_conflict');
        record = reclaimed.record;
        createdIds.push(record.id);
      }
      if (!result.created && record.state === 'reserved' && !record.post_id
        && record.owner_key !== input.ownerKey && reservationExpired(record)) {
        const reclaimed = await compareAndSetRecord<PublishContentFenceRecord>({
          store: input.dataStore,
          collection: 'publish_content_fences',
          id: record.id,
          expected: {
            state: 'reserved', owner_key: record.owner_key || '', post_id: '', revision: Number(record.revision || 0),
          },
          patch: {
            owner_key: input.ownerKey,
            revision: Number(record.revision || 0) + 1,
            updated_at: now,
          },
        });
        if (!reclaimed.ok) throw new PublishContentFenceError('publish_content_fence_reservation_conflict');
        record = reclaimed.record;
        createdIds.push(record.id);
      }
      if (record.post_id) {
        const linked = await input.dataStore.getById<PostRecord>('posts', record.post_id);
        if (!linked || linked.tenant_id !== input.tenantId) {
          throw new PublishContentFenceError('publish_content_fence_orphaned', record.post_id);
        }
        const stats = jsonObject(linked.stats);
        const reusableFailedDirect = input.allowFailedDirectReuse === true
          && stats.source === 'manual' && stats.directPublish === true && stats.status === 'failed'
          && linked.reconciliation_required !== true && !String(linked.platform_post_id || '');
        const sameOwner = record.owner_key === input.ownerKey;
        if (!sameOwner && !reusableFailedDirect && postProtectsContentFence(linked, accountId)) {
          const status = String(stats.status || '');
          throw new PublishContentFenceError(
            status === 'needs_reconciliation' || status === 'publishing'
              ? 'publish_content_outcome_unresolved'
              : status === 'published' || String(linked.platform_post_id || '')
                ? 'publish_content_already_published'
                : 'publish_content_already_scheduled',
            linked.id,
          );
        }
        if (!sameOwner && !reusableFailedDirect) {
          throw new PublishContentFenceError('publish_content_fence_requires_explicit_release', linked.id);
        }
        linkedPosts.push(linked);
      } else if (!result.created && record.owner_key !== input.ownerKey) {
        throw new PublishContentFenceError('publish_content_reservation_in_progress');
      }
      records.push(record);
    }
    return { records, linkedPosts, createdIds };
  } catch (error) {
    await releasePublishContentReservations(input.dataStore, createdIds, input.ownerKey).catch(() => undefined);
    throw error;
  }
}

export async function attachPublishContentFences(
  dataStore: DataStore,
  records: PublishContentFenceRecord[],
  ownerKey: string,
  postId: string,
): Promise<void> {
  const now = new Date().toISOString();
  for (const record of records) {
    if (record.post_id === postId && record.state === 'active') continue;
    if (record.post_id && record.post_id !== postId) throw new PublishContentFenceError('publish_content_fence_attach_conflict', record.post_id);
    const attached = await compareAndSetRecord<PublishContentFenceRecord>({
      store: dataStore,
      collection: 'publish_content_fences',
      id: record.id,
      expected: {
        state: 'reserved', owner_key: ownerKey, post_id: '', revision: Number(record.revision || 0),
      },
      patch: {
        state: 'active', post_id: postId, revision: Number(record.revision || 0) + 1, updated_at: now,
      },
    });
    if (!attached.ok) {
      const current = await dataStore.getById<PublishContentFenceRecord>('publish_content_fences', record.id);
      if (current?.state === 'active' && current.owner_key === ownerKey && current.post_id === postId) continue;
      throw new PublishContentFenceError('publish_content_fence_attach_conflict', current?.post_id || '');
    }
  }
}

export async function releasePublishContentReservations(
  dataStore: DataStore,
  recordIds: string[],
  ownerKey: string,
): Promise<void> {
  for (const id of recordIds) {
    const record = await dataStore.getById<PublishContentFenceRecord>('publish_content_fences', id);
    if (!record || record.state !== 'reserved' || record.owner_key !== ownerKey || record.post_id) continue;
    await compareAndSetRecord<PublishContentFenceRecord>({
      store: dataStore,
      collection: 'publish_content_fences',
      id,
      expected: { state: 'reserved', owner_key: ownerKey, post_id: '', revision: Number(record.revision || 0) },
      patch: { state: 'released', owner_key: '', revision: Number(record.revision || 0) + 1, updated_at: new Date().toISOString() },
    });
  }
}

export async function releasePostContentFences(
  dataStore: DataStore,
  postId: string,
  exceptFenceKeys: string[] = [],
): Promise<void> {
  const keep = new Set(exceptFenceKeys);
  const records = await listAllRecords<PublishContentFenceRecord>({
    store: dataStore,
    collection: 'publish_content_fences',
    query: { where: { post_id: postId }, sort: 'id' },
  });
  for (const record of records) {
    if (keep.has(record.fence_key) || record.state !== 'active') continue;
    await compareAndSetRecord<PublishContentFenceRecord>({
      store: dataStore,
      collection: 'publish_content_fences',
      id: record.id,
      expected: { state: 'active', post_id: postId, revision: Number(record.revision || 0) },
      patch: {
        state: 'released', owner_key: '', post_id: '', revision: Number(record.revision || 0) + 1,
        updated_at: new Date().toISOString(),
      },
    });
  }
}

/** Release only fences created/attached by one failed mutation. */
export async function releaseSpecificPostContentFences(
  dataStore: DataStore,
  postId: string,
  fenceKeys: string[],
  exceptFenceKeys: string[] = [],
): Promise<void> {
  const keep = new Set(exceptFenceKeys);
  for (const fenceKey of Array.from(new Set(fenceKeys)).filter(Boolean)) {
    if (keep.has(fenceKey)) continue;
    const result = await dataStore.list<PublishContentFenceRecord>('publish_content_fences', {
      where: { fence_key: fenceKey }, page: 1, perPage: 1,
    });
    const record = result.items[0];
    if (!record || record.state !== 'active' || record.post_id !== postId) continue;
    await compareAndSetRecord<PublishContentFenceRecord>({
      store: dataStore,
      collection: 'publish_content_fences',
      id: record.id,
      expected: { state: 'active', post_id: postId, revision: Number(record.revision || 0) },
      patch: {
        state: 'released', owner_key: '', post_id: '', revision: Number(record.revision || 0) + 1,
        updated_at: new Date().toISOString(),
      },
    });
  }
}

export async function reconcileStalePublishContentReservations(
  dataStore: DataStore,
  now = Date.now(),
): Promise<{ inspected: number; released: number; conflicts: number }> {
  const records = await listAllRecords<PublishContentFenceRecord>({
    store: dataStore,
    collection: 'publish_content_fences',
    query: { where: { state: 'reserved' }, sort: 'updated_at,id' },
  });
  let released = 0;
  let conflicts = 0;
  for (const record of records) {
    if (record.post_id || !reservationExpired(record, now)) continue;
    const changed = await compareAndSetRecord<PublishContentFenceRecord>({
      store: dataStore,
      collection: 'publish_content_fences',
      id: record.id,
      expected: {
        state: 'reserved', owner_key: record.owner_key || '', post_id: '', revision: Number(record.revision || 0),
      },
      patch: {
        state: 'released', owner_key: '', revision: Number(record.revision || 0) + 1,
        updated_at: new Date(now).toISOString(),
      },
    });
    if (changed.ok) released += 1;
    else conflicts += 1;
  }
  return { inspected: records.length, released, conflicts };
}
