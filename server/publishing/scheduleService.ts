import { createHash } from 'node:crypto';
import { store } from '../storage/index.js';
import { createTrackedPostDraft, type PostRecord } from './waLink.js';
import { compareAndSetRecord } from '../digitalEmployees/reliableKernel.js';
import { normalizeApprovedPublicVideoUrl, resolveTenantPublishingVideo } from './localVideoSecurity.js';
import type { DataStore } from '../storage/datastore.js';
import { listAllRecords } from '../storage/pagination.js';
import { publishContentFenceKey, type PublishContentFenceRecord } from './publishContentFence.js';
import { tiktokDirectPostAudited, type TikTokPrivacyLevel, type TikTokPublishOptions } from '../integrations/social.js';
import { withPublishQueueProjection } from './publishQueueProjection.js';

const TIKTOK_PRIVACY_LEVELS = new Set<TikTokPrivacyLevel>([
  'PUBLIC_TO_EVERYONE',
  'MUTUAL_FOLLOW_FRIENDS',
  'FOLLOWER_OF_CREATOR',
  'SELF_ONLY',
]);

export interface SchedulePostInput {
  tenantId: string; contentId: string; platform: string; title: string; scheduledAt: string; language?: string;
  coverUrl?: string; description?: string; firstComment?: string; videoPath?: string; videoUrl?: string;
  videoSha256?: string;
  publishContentDigest?: string;
  contentFenceKeys?: string[];
  tiktokPublishOptionsByAccount?: Record<string, TikTokPublishOptions>;
  targetAccountIds: string[]; targetAccountLabels?: string[]; trackWaLink?: boolean; scheduleLocked?: boolean;
  source?: 'manual' | 'digital_employee'; approvalId?: string; approvedPayloadHash?: string; idempotencyKey?: string;
  runId?: string; approvedActionHash?: string; runRevision?: number; approvalRevision?: number; fenceRevision?: number;
}
function text(value: unknown, max = 5000): string { return String(value ?? '').trim().slice(0, max); }

function canonicalTikTokPublishOptionsByAccount(
  value: unknown,
  targetAccountIds: string[],
): Record<string, TikTokPublishOptions> {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return Object.fromEntries(
    Array.from(new Set(targetAccountIds.map(item => text(item, 120)).filter(Boolean)))
      .sort()
      .flatMap(accountId => {
        const raw = source[accountId];
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
        const options = raw as Record<string, unknown>;
        return [[accountId, {
          privacyLevel: text(options.privacyLevel, 40) as TikTokPrivacyLevel,
          allowComment: options.allowComment === true,
          allowDuet: options.allowDuet === true,
          allowStitch: options.allowStitch === true,
          brandContentToggle: options.brandContentToggle === true,
          brandOrganicToggle: options.brandOrganicToggle === true,
          isAigc: options.isAigc === true,
          userConsent: options.userConsent === true,
        } satisfies TikTokPublishOptions] as const];
      }),
  );
}

/**
 * Normalize the only TikTok fields that may be persisted in a scheduled action
 * and fail closed before the record becomes executable. Creator capabilities
 * are deliberately queried again by the publisher immediately before upload.
 */
export function validateScheduledTikTokPublishOptions(input: {
  platform: string;
  targetAccountIds: string[];
  value: unknown;
  audited?: boolean;
}): Record<string, TikTokPublishOptions> {
  if (text(input.platform, 30).toLowerCase() !== 'tiktok') return {};
  const targetAccountIds = Array.from(new Set(input.targetAccountIds.map(item => text(item, 120)).filter(Boolean))).sort();
  if (!targetAccountIds.length) throw new Error('target_account_required');
  const normalized = canonicalTikTokPublishOptionsByAccount(input.value, targetAccountIds);
  for (const accountId of targetAccountIds) {
    const options = normalized[accountId];
    if (!options) throw new Error('tiktok_publish_options_required');
    if (!TIKTOK_PRIVACY_LEVELS.has(options.privacyLevel)) throw new Error('tiktok_privacy_level_required');
    if (options.userConsent !== true) throw new Error('tiktok_user_consent_required');
    if ((input.audited ?? tiktokDirectPostAudited()) === false && options.privacyLevel !== 'SELF_ONLY') {
      throw new Error('tiktok_unaudited_self_only_required');
    }
    if (options.brandContentToggle && options.privacyLevel === 'SELF_ONLY') {
      throw new Error('tiktok_branded_content_private_invalid');
    }
  }
  return normalized;
}

export function schedulePayloadHash(input: SchedulePostInput): string {
  const scheduled = Date.parse(input.scheduledAt);
  const ids = input.targetAccountIds.map(item => text(item, 120));
  const labels = input.targetAccountLabels || [];
  const targetAccounts = ids
    .map((id, index) => ({ id, label: text(labels[index], 200) }))
    .filter(item => item.id)
    .filter((item, index, items) => items.findIndex(candidate => candidate.id === item.id) === index)
    .sort((left, right) => left.id.localeCompare(right.id) || left.label.localeCompare(right.label));
  const platform = text(input.platform, 30);
  return createHash('sha256').update(JSON.stringify({
    tenantId: text(input.tenantId, 120),
    contentId: text(input.contentId, 200),
    platform,
    title: text(input.title, 500) || 'Untitled content',
    scheduledAt: Number.isFinite(scheduled) ? new Date(scheduled).toISOString() : text(input.scheduledAt, 80),
    language: text(input.language, 30),
    coverUrl: text(input.coverUrl),
    description: text(input.description),
    firstComment: text(input.firstComment),
    videoPath: text(input.videoPath),
    videoUrl: text(input.videoUrl),
    videoSha256: text(input.videoSha256, 128).toLowerCase(),
    publishContentDigest: text(input.publishContentDigest, 128).toLowerCase(),
    contentFenceKeys: Array.from(new Set((input.contentFenceKeys || [])
      .map(item => text(item, 128)).filter(Boolean))).sort(),
    ...(platform.toLowerCase() === 'tiktok' ? {
      tiktokPublishOptionsByAccount: canonicalTikTokPublishOptionsByAccount(
        input.tiktokPublishOptionsByAccount,
        ids,
      ),
    } : {}),
    targetAccounts,
    trackWaLink: input.trackWaLink !== false,
    scheduleLocked: input.scheduleLocked === true,
    source: input.source || 'manual',
    runId: text(input.runId, 120),
    approvalId: text(input.approvalId, 120),
    approvedActionHash: text(input.approvedActionHash, 128),
    runRevision: Number(input.runRevision || 0),
    approvalRevision: Number(input.approvalRevision || 0),
    fenceRevision: Number(input.fenceRevision || 0),
  })).digest('hex');
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

function inputFromStoredPost(post: PostRecord, source: 'manual' | 'digital_employee'): SchedulePostInput {
  const stats = jsonObject(post.stats);
  const targetAccountIds = Array.isArray(stats.targetAccountIds)
    ? stats.targetAccountIds.map(String).map(item => text(item, 120)).filter(Boolean)
    : [];
  const targetAccountLabels = Array.isArray(stats.targetAccountLabels)
    ? stats.targetAccountLabels.map(String).map(item => text(item, 200))
    : [];
  return {
    tenantId: text(post.tenant_id, 120),
    contentId: text(post.content_id, 200),
    platform: text(post.platform, 30),
    title: text(post.title, 500),
    scheduledAt: text(post.published_at, 80),
    language: text(stats.language, 30),
    coverUrl: text(stats.coverUrl),
    description: text(stats.description),
    firstComment: text(stats.firstComment),
    videoPath: text(stats.videoPath),
    videoUrl: text(stats.videoUrl),
    videoSha256: text(stats.videoSha256, 128).toLowerCase(),
    publishContentDigest: text(stats.publishContentDigest, 128).toLowerCase(),
    contentFenceKeys: Array.isArray(stats.publishContentFenceKeys) ? stats.publishContentFenceKeys.map(String) : [],
    tiktokPublishOptionsByAccount: canonicalTikTokPublishOptionsByAccount(
      stats.tiktokPublishOptionsByAccount,
      targetAccountIds,
    ),
    targetAccountIds,
    targetAccountLabels,
    trackWaLink: stats.trackWaLink !== false,
    scheduleLocked: stats.scheduleLocked === true,
    source,
    ...(source === 'digital_employee' ? {
      runId: text(post.digital_employee_run_id, 120),
      approvalId: text(post.digital_employee_approval_id, 120),
      approvedActionHash: text(post.digital_employee_action_hash, 128),
      runRevision: Number(stats.runRevision || 0),
      approvalRevision: Number(stats.approvalRevision || 0),
      fenceRevision: Number(stats.approvedFenceRevision || 0),
    } : {}),
  };
}

export type ScheduledPostIdempotencyDecision = 'replay' | 'conflict';

/** Decide whether a durable idempotency binding is an exact safe replay. */
export function scheduledPostIdempotencyDecision(
  existing: PostRecord,
  input: SchedulePostInput,
): ScheduledPostIdempotencyDecision {
  if (existing.tenant_id !== input.tenantId || existing.platform !== input.platform) return 'conflict';
  if (text(existing.direct_publish_fence_key, 128)) return 'conflict';
  const stats = jsonObject(existing.stats);
  const source = input.source || 'manual';
  if (stats.source !== source) return 'conflict';
  const integrity = verifyApprovedScheduledPost(existing);
  return integrity.ok && integrity.storedHash === schedulePayloadHash(input) ? 'replay' : 'conflict';
}

export async function listTenantCalendarPosts(
  dataStore: DataStore,
  tenantId: string,
  maxRecords = 250_000,
): Promise<PostRecord[]> {
  return listAllRecords<PostRecord>({
    store: dataStore,
    collection: 'posts',
    query: { where: { tenant_id: tenantId }, sort: 'published_at' },
    maxRecords,
  });
}

/** Recompute the exact action hash from durable post fields immediately before publishing. */
export function verifyApprovedScheduledPost(post: PostRecord): {
  ok: boolean;
  expectedHash: string;
  storedHash: string;
  reason?: string;
} {
  const stats = jsonObject(post.stats);
  const source = stats.source === 'digital_employee' ? 'digital_employee' : stats.source === 'manual' ? 'manual' : null;
  if (!source) return { ok: false, expectedHash: '', storedHash: '', reason: 'scheduled_post_source_missing' };
  const expectedHash = schedulePayloadHash(inputFromStoredPost(post, source));
  const storedHash = text(stats.schedulePayloadHash, 128);
  if (source === 'manual') {
    if (!storedHash) return { ok: false, expectedHash, storedHash, reason: 'manual_schedule_hash_missing' };
    return storedHash === expectedHash
      ? { ok: true, expectedHash, storedHash }
      : { ok: false, expectedHash, storedHash, reason: 'manual_schedule_payload_changed' };
  }
  if (!text(post.digital_employee_run_id, 120)
    || !text(post.digital_employee_approval_id, 120)
    || !/^[a-f0-9]{64}$/.test(text(post.digital_employee_action_hash, 128))) {
    return { ok: false, expectedHash, storedHash, reason: 'approved_schedule_governance_binding_missing' };
  }
  if (text(stats.approvalId, 120) !== text(post.digital_employee_approval_id, 120)
    || text(stats.approvedActionHash, 128) !== text(post.digital_employee_action_hash, 128)) {
    return { ok: false, expectedHash, storedHash, reason: 'approved_schedule_governance_binding_changed' };
  }
  if (!storedHash) return { ok: false, expectedHash, storedHash, reason: 'approved_schedule_hash_missing' };
  if (storedHash !== expectedHash || text(stats.approvedPayloadHash, 128) !== expectedHash) {
    return { ok: false, expectedHash, storedHash, reason: 'approved_schedule_payload_changed' };
  }
  return { ok: true, expectedHash, storedHash };
}

export async function createScheduledPost(input: SchedulePostInput): Promise<PostRecord> {
  const scheduled = Date.parse(input.scheduledAt);
  if (!Number.isFinite(scheduled)) throw new Error('scheduled_at_invalid');
  if (!text(input.platform, 30)) throw new Error('platform_required');
  if (!input.targetAccountIds.length) throw new Error('target_account_required');
  const tiktokPublishOptionsByAccount = validateScheduledTikTokPublishOptions({
    platform: input.platform,
    targetAccountIds: input.targetAccountIds,
    value: input.tiktokPublishOptionsByAccount,
  });
  const requestedVideoPath = text(input.videoPath);
  const normalizedVideoPath = requestedVideoPath ? resolveTenantPublishingVideo(input.tenantId, requestedVideoPath) : '';
  if (requestedVideoPath && !normalizedVideoPath) throw new Error('video_path_outside_tenant_storage');
  const requestedVideoUrl = text(input.videoUrl);
  const normalizedVideoUrl = requestedVideoUrl ? normalizeApprovedPublicVideoUrl(requestedVideoUrl) : '';
  if (requestedVideoUrl && !normalizedVideoUrl) throw new Error('video_url_origin_not_allowed');
  input = {
    ...input,
    videoPath: normalizedVideoPath || '',
    videoUrl: normalizedVideoUrl || '',
    ...(text(input.platform, 30).toLowerCase() === 'tiktok' ? { tiktokPublishOptionsByAccount } : {}),
  };
  if (input.source === 'digital_employee' && !text(input.videoPath)) throw new Error('local_video_artifact_required');
  if (input.source === 'digital_employee' && !/^[a-f0-9]{64}$/.test(text(input.videoSha256, 128).toLowerCase())) throw new Error('video_digest_required');
  if (input.source === 'digital_employee' && (!text(input.runId, 120) || !text(input.approvalId, 120))) throw new Error('publishing_governance_identity_required');
  if (input.source === 'digital_employee' && !/^[a-f0-9]{64}$/.test(text(input.approvedActionHash, 128))) throw new Error('approved_action_hash_required');
  if (input.source === 'digital_employee' && (!Number.isInteger(input.runRevision) || Number(input.runRevision) < 0
    || !Number.isInteger(input.approvalRevision) || Number(input.approvalRevision) < 0
    || !Number.isInteger(input.fenceRevision) || Number(input.fenceRevision) < 0)) {
    throw new Error('publishing_governance_revision_invalid');
  }
  const expectedHash = schedulePayloadHash(input);
  if (input.source === 'digital_employee' && input.approvedPayloadHash !== expectedHash) throw new Error('approved_payload_hash_mismatch');
  let existingRecord: PostRecord | undefined;
  if (input.idempotencyKey) {
    const existing = await store.list<PostRecord>('posts', { where: { tenant_id: input.tenantId, digital_employee_idempotency_key: input.idempotencyKey }, perPage: 1 });
    existingRecord = existing.items[0];
    if (existingRecord && scheduledPostIdempotencyDecision(existingRecord, input) === 'replay') return existingRecord;
    const existingStats = existingRecord ? jsonObject(existingRecord.stats) : {};
    if (existingRecord && Object.keys(existingStats).length > 0) {
      throw new Error('scheduled_post_idempotency_payload_conflict');
    }
    if (existingRecord && (existingRecord.tenant_id !== input.tenantId
      || existingRecord.platform !== input.platform
      || text(existingRecord.direct_publish_fence_key, 128))) {
      throw new Error('scheduled_post_idempotency_payload_conflict');
    }
  }
  let tracked = existingRecord;
  if (!tracked) try {
    tracked = await createTrackedPostDraft(input.tenantId, {
      contentId: text(input.contentId, 200),
      platform: text(input.platform, 30),
      title: text(input.title, 500) || 'Untitled content',
      language: text(input.language, 30),
      enabled: input.trackWaLink !== false,
      digitalEmployeeIdempotencyKey: text(input.idempotencyKey, 200),
    });
  } catch (error) {
    if (!input.idempotencyKey) throw error;
    const raced = await store.list<PostRecord>('posts', { where: { tenant_id: input.tenantId, digital_employee_idempotency_key: input.idempotencyKey }, perPage: 1 });
    if (!raced.items[0]) throw error;
    tracked = raced.items[0];
  }
  if (!tracked) throw new Error('scheduled_post_reservation_failed');
  const stats = {
    // A post is deliberately non-due until every durable content fence has
    // been linked. Callers must finish with activatePreparedScheduledPost().
    status: 'reserving', coverUrl: text(input.coverUrl), description: text(input.description), firstComment: text(input.firstComment), language: text(input.language, 30),
    videoPath: text(input.videoPath), videoUrl: text(input.videoUrl), videoSha256: text(input.videoSha256, 128).toLowerCase(), trackWaLink: input.trackWaLink !== false,
    publishContentDigest: text(input.publishContentDigest, 128).toLowerCase(),
    publishContentFenceKeys: Array.from(new Set((input.contentFenceKeys || []).map(item => text(item, 128)).filter(Boolean))).sort(),
    ...(text(input.platform, 30).toLowerCase() === 'tiktok' ? {
      tiktokPublishOptionsByAccount,
    } : {}),
    scheduleLocked: input.scheduleLocked === true, targetAccountIds: [...new Set(input.targetAccountIds.map(item => text(item, 120)).filter(Boolean))],
    targetAccountLabels: (input.targetAccountLabels || []).map(item => text(item, 200)), publishAttempts: 0, publishResults: {}, publishError: '', nextPublishAttemptAt: '', warnings: [],
    source: input.source || 'manual', approvalId: text(input.approvalId, 120), approvedPayloadHash: text(input.approvedPayloadHash, 128), schedulePayloadHash: expectedHash,
    approvedActionHash: text(input.approvedActionHash, 128), runRevision: Number(input.runRevision || 0), approvalRevision: Number(input.approvalRevision || 0),
    approvedFenceRevision: Number(input.fenceRevision || 0), authorizedFenceRevision: Number(input.fenceRevision || 0),
  };
  const changed = await compareAndSetRecord<PostRecord>({
    store,
    collection: 'posts',
    id: tracked.id,
    expected: {
      digital_employee_idempotency_key: text(input.idempotencyKey, 200),
      publish_revision: Number(tracked.publish_revision || 0),
    },
    patch: withPublishQueueProjection(tracked, {
      published_at: new Date(scheduled).toISOString(),
      stats,
      digital_employee_idempotency_key: text(input.idempotencyKey, 200),
      digital_employee_run_id: text(input.runId, 120),
      digital_employee_approval_id: text(input.approvalId, 120),
      digital_employee_action_hash: text(input.approvedActionHash, 128),
      digital_employee_fence_revision: Number(input.fenceRevision || 0),
      publish_revision: Number(tracked.publish_revision || 0) + 1,
    }),
  });
  if (!changed.ok) {
    const raced = await store.getById<PostRecord>('posts', tracked.id);
    if (raced && scheduledPostIdempotencyDecision(raced, input) === 'replay') return raced;
    throw new Error('scheduled_post_persistence_conflict');
  }
  const saved = changed.record;
  if (!saved) throw new Error('scheduled_post_read_after_write_failed');
  return saved;
}

export async function scheduledPostContentFencesAttached(
  dataStore: DataStore,
  post: PostRecord,
): Promise<boolean> {
  const stats = jsonObject(post.stats);
  const digest = text(stats.publishContentDigest, 128).toLowerCase();
  const accountIds = Array.isArray(stats.targetAccountIds)
    ? Array.from(new Set(stats.targetAccountIds.map(String).map(item => text(item, 120)).filter(Boolean))).sort()
    : [];
  const storedKeys = new Set(Array.isArray(stats.publishContentFenceKeys)
    ? stats.publishContentFenceKeys.map(String).map(item => text(item, 128)).filter(Boolean)
    : []);
  if (!accountIds.length || !/^[a-f0-9]{64}$/.test(digest) || storedKeys.size !== accountIds.length) return false;
  for (const accountId of accountIds) {
    const fenceKey = publishContentFenceKey({
      tenantId: post.tenant_id,
      platform: post.platform,
      accountId,
      contentDigest: digest,
    });
    if (!storedKeys.has(fenceKey)) return false;
    const result = await dataStore.list<PublishContentFenceRecord>('publish_content_fences', {
      where: { fence_key: fenceKey },
      page: 1,
      perPage: 1,
    });
    const fence = result.items[0];
    if (!fence || fence.state !== 'active' || fence.post_id !== post.id
      || fence.tenant_id !== post.tenant_id || fence.platform !== post.platform
      || fence.account_id !== accountId || fence.content_digest !== digest) return false;
  }
  return true;
}

/**
 * The only transition that makes a prepared schedule executable. The fence
 * rows are checked immediately before a revision CAS so a crash can leave an
 * inert `reserving` post, never an unfenced due post.
 */
export async function activatePreparedScheduledPost(
  post: PostRecord,
  dataStore: DataStore = store,
): Promise<PostRecord> {
  const current = await dataStore.getById<PostRecord>('posts', post.id);
  if (!current || current.tenant_id !== post.tenant_id) throw new Error('scheduled_post_reservation_missing');
  const stats = jsonObject(current.stats);
  if (stats.status === 'scheduled') {
    if (!verifyApprovedScheduledPost(current).ok || !await scheduledPostContentFencesAttached(dataStore, current)) {
      throw new Error('scheduled_post_activation_integrity_failed');
    }
    return current;
  }
  if (stats.status !== 'reserving' || !verifyApprovedScheduledPost(current).ok) {
    throw new Error('scheduled_post_not_prepared');
  }
  if (!await scheduledPostContentFencesAttached(dataStore, current)) {
    throw new Error('scheduled_post_content_fences_not_attached');
  }
  const changed = await compareAndSetRecord<PostRecord>({
    store: dataStore,
    collection: 'posts',
    id: current.id,
    expected: {
      publish_revision: Number(current.publish_revision || 0),
      publish_lease_owner: current.publish_lease_owner || '',
      publish_lease_expires_at: current.publish_lease_expires_at || '',
      digital_employee_fence_revision: Number(current.digital_employee_fence_revision || 0),
      reconciliation_required: false,
    },
    patch: withPublishQueueProjection(current, {
      stats: { ...stats, status: 'scheduled', activatedAt: new Date().toISOString() },
      publish_revision: Number(current.publish_revision || 0) + 1,
    }),
  });
  if (!changed.ok) {
    const raced = await dataStore.getById<PostRecord>('posts', current.id);
    if (raced && jsonObject(raced.stats).status === 'scheduled'
      && verifyApprovedScheduledPost(raced).ok
      && await scheduledPostContentFencesAttached(dataStore, raced)) return raced;
    throw new Error('scheduled_post_activation_conflict');
  }
  return changed.record;
}
