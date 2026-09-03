import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { uploadVideoToYouTube, type YouTubeConfig } from '../integrations/youtube.js';
import {
  publishInstagramReel,
  uploadFacebookVideo,
  uploadTikTokVideo,
  type SocialPlatform,
  type SocialUploadInput,
  type TikTokPublishOptions,
} from '../integrations/social.js';
import { recordSuccessfulPublish, type PublishPlatform } from '../lib/publishHistory.js';
import { compareAndSetRecord } from '../digitalEmployees/reliableKernel.js';
import { store } from '../storage/index.js';
import { appendTrackedWaLink, createTrackedPostDraft, type PostDraftInput, type PostRecord } from './waLink.js';
import { normalizeApprovedPublicVideoUrl, resolveTenantPublishingVideo, tenantPublishingVideoSha256 } from './localVideoSecurity.js';
import type { DataStore } from '../storage/datastore.js';
import {
  approvedUrlContentDigest,
  attachPublishContentFences,
  publishContentFenceKey,
  releasePublishContentReservations,
  reservePublishContentFences,
} from './publishContentFence.js';
import { withPublishQueueProjection } from './publishQueueProjection.js';
import {
  newPublishOperationId,
  persistPublishOperationTransition,
  publishOperationQuiescedPatch,
  publishOperationQuiescingPatch,
  publishOperationStartPatch,
  runAbortablePublishOperation,
} from './publishOperationFence.js';
import {
  persistProviderOperationEvidence,
  providerOperationAuditReference,
} from './providerOperationEvidence.js';
import {
  socialAccountCredentials,
  youtubeAccountCredentials,
  type SocialCredentialRecord,
  type YouTubeCredentialRecord,
} from '../security/platformCredentials.js';

const execFileAsync = promisify(execFile);

interface YouTubeAccountRecord extends YouTubeCredentialRecord {
  id: string;
  tenantId: string;
  clientId: string;
  status: 'connected' | 'error' | 'expired';
}

interface SocialAccountRecord extends SocialCredentialRecord {
  id: string;
  tenantId: string;
  platform: SocialPlatform;
  providerAccountId: string;
  status: 'connected' | 'error' | 'expired';
}

export interface PublishToAccountInput {
  tenantId: string;
  accountId: string;
  platform: PublishPlatform;
  videoPath?: string;
  videoUrl?: string;
  title: string;
  description?: string;
  tags?: unknown;
  privacyStatus?: 'private' | 'unlisted' | 'public';
  tiktokPublishOptions?: TikTokPublishOptions;
  madeForKids?: boolean;
  projectId?: string;
  generationVersionId?: string;
  ratio?: string;
  language?: string;
  contentId?: string;
  idempotencyKey?: string;
  trackWaLink?: boolean;
  trackingPost?: PostRecord;
  finalizeTracking?: boolean;
  /** Internal, server-derived values. Route bodies are never spread into them. */
  directPublishContentDigest?: string;
  directPublishFenceKey?: string;
  directPublishContentSource?: 'local_sha256' | 'approved_url';
  directPublishRequestHash?: string;
  publishOperationId?: string;
  providerOperationId?: string;
  onProviderOperationId?: (providerOperationId: string) => void | Promise<void>;
  signal?: AbortSignal;
  transportTimeoutMs?: number;
}

export interface PublishToAccountResult {
  video: unknown;
  tracking: PostRecord;
  publishRecord: ReturnType<typeof recordSuccessfulPublish> | null;
  platformPostId: string;
  providerOperationId?: string;
}

export type PlatformPublishFailureClassification = {
  disposition: 'definitive_rejection' | 'outcome_unknown';
  outcomeUnknown: boolean;
  retrySafe: boolean;
  statusCode: number | null;
  reason: 'definitive_http_4xx' | 'local_rejection' | 'provider_preflight' | 'ambiguous_http_4xx' | 'http_5xx' | 'network_or_timeout' | 'existing_unresolved_publish' | 'already_published' | 'unclassified';
};

export type PlatformPublishFailureContext = {
  trackingPostId: string;
  reconciliationPersisted: boolean;
  outcomeUnknown: boolean;
};

type DirectPublishResult = {
  status: 'published' | 'failed' | 'unknown';
  platformPostId?: string;
  publishedAt?: string;
  error?: string;
  failedAt?: string;
  outcomeUnknown?: boolean;
  failureReason?: string;
  httpStatus?: number;
  providerOperationId?: string;
};

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* empty */ }
  }
  return {};
}

function publishFailureMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : '平台未返回确定发布结果';
}

function numericHttpStatus(value: unknown): number | null {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

/**
 * Classifies only whether another automatic publish attempt is safe. Anything
 * other than a definitive platform rejection is intentionally treated as
 * unknown because the remote platform may have committed before the response
 * was lost. This function is pure so every caller uses the same fail-closed
 * semantics.
 */
export function classifyPlatformPublishFailure(error: unknown): PlatformPublishFailureClassification {
  const candidate = error && typeof error === 'object' ? error as {
    statusCode?: unknown;
    code?: unknown;
    response?: { status?: unknown };
    publishFailureClassification?: PlatformPublishFailureClassification;
  } : {};
  if (candidate.publishFailureClassification) return candidate.publishFailureClassification;
  const providerStatus = numericHttpStatus(candidate.response?.status);
  const localStatus = numericHttpStatus(candidate.statusCode);
  const statusCode = providerStatus ?? localStatus;
  const ambiguousClientStatuses = new Set([408, 409, 425]);
  // A locally generated pre-provider 409/423 is a safe rejection. The same
  // HTTP status received from a provider is ambiguous: it may be a duplicate
  // response after the provider already accepted an earlier request.
  if (providerStatus === null && localStatus !== null && localStatus >= 400 && localStatus < 500
    && localStatus !== 408 && localStatus !== 425) {
    return {
      disposition: 'definitive_rejection',
      outcomeUnknown: false,
      retrySafe: localStatus !== 409 && localStatus !== 423,
      statusCode: localStatus,
      reason: 'local_rejection',
    };
  }
  if (providerStatus !== null && providerStatus >= 400 && providerStatus < 500
    && !ambiguousClientStatuses.has(providerStatus)) {
    return {
      disposition: 'definitive_rejection',
      outcomeUnknown: false,
      retrySafe: true,
      statusCode: providerStatus,
      reason: 'definitive_http_4xx',
    };
  }
  const code = typeof candidate.code === 'string' ? candidate.code.toUpperCase() : '';
  const isNetworkFailure = !statusCode || [
    'ECONNABORTED', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH',
    'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
  ].includes(code);
  return {
    disposition: 'outcome_unknown',
    outcomeUnknown: true,
    retrySafe: false,
    statusCode,
    reason: statusCode === null && isNetworkFailure
      ? 'network_or_timeout'
      : statusCode !== null && statusCode >= 500
        ? 'http_5xx'
        : statusCode !== null && ambiguousClientStatuses.has(statusCode)
          ? 'ambiguous_http_4xx'
          : 'unclassified',
  };
}

export function directPublishRequestHash(input: Pick<PublishToAccountInput,
  'tenantId' | 'accountId' | 'platform' | 'directPublishContentDigest' | 'title' | 'description'
  | 'tags' | 'privacyStatus' | 'tiktokPublishOptions' | 'madeForKids' | 'contentId' | 'language' | 'trackWaLink'>): string {
  const tags = parseTags(input.tags, input.description || '');
  return createHash('sha256').update(JSON.stringify({
    version: 1,
    tenantId: input.tenantId.trim(),
    accountId: input.accountId.trim(),
    platform: input.platform,
    contentDigest: String(input.directPublishContentDigest || '').trim().toLowerCase(),
    title: input.title.trim(),
    description: String(input.description || ''),
    tags,
    privacyStatus: input.privacyStatus || '',
    tiktokPublishOptions: input.tiktokPublishOptions || null,
    madeForKids: input.madeForKids === true,
    contentId: String(input.contentId || '').trim(),
    language: String(input.language || '').trim(),
    trackWaLink: input.trackWaLink !== false,
  })).digest('hex');
}

function publishError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function localPublishPreparationError(message: string, statusCode = 500): Error {
  return Object.assign(new Error(message), {
    statusCode,
    publishFailureClassification: {
      disposition: 'definitive_rejection',
      outcomeUnknown: false,
      retrySafe: true,
      statusCode,
      reason: 'local_rejection',
    } satisfies PlatformPublishFailureClassification,
  });
}

function parseTags(tags: unknown, description: string): string[] {
  if (Array.isArray(tags)) return tags.map(String).map(item => item.replace(/^#/, '').trim()).filter(Boolean);
  if (typeof tags === 'string') return tags.split(/[\s,，]+/).map(item => item.replace(/^#/, '').trim()).filter(Boolean);
  return Array.from(description.matchAll(/#([\p{L}\p{N}_-]+)/gu)).map(match => match[1]);
}

function accountStatus(error: any): number {
  return Number(error?.statusCode || error?.response?.status || 500) || 500;
}

function publishTransportTimeoutMs(requested?: number): number {
  const configured = Number(requested ?? process.env.PUBLISH_ACCOUNT_TIMEOUT_MS ?? 10 * 60_000);
  return Number.isFinite(configured) && configured > 0 ? Math.max(30_000, configured) : 10 * 60_000;
}

export type DirectPublishAdmission =
  | { allow: true }
  | { allow: false; reason: 'binding_conflict' | 'publishing' | 'needs_reconciliation' | 'published' | 'closed' };

export { approvedUrlContentDigest, publishContentFenceKey as directPublishFenceKey };

export function directPublishAdmission(
  input: Pick<PublishToAccountInput,
    'tenantId' | 'accountId' | 'platform' | 'directPublishFenceKey' | 'directPublishContentDigest' | 'directPublishRequestHash'>,
  tracked: PostRecord,
): DirectPublishAdmission {
  if (tracked.tenant_id !== input.tenantId || tracked.platform !== input.platform) {
    return { allow: false, reason: 'binding_conflict' };
  }
  const stats = jsonObject(tracked.stats);
  const accountIds = Array.isArray(stats.targetAccountIds) ? stats.targetAccountIds.map(String) : [];
  if (accountIds.length && !accountIds.includes(input.accountId)) return { allow: false, reason: 'binding_conflict' };
  if (input.directPublishFenceKey && String(tracked.direct_publish_fence_key || '') !== input.directPublishFenceKey) {
    return { allow: false, reason: 'binding_conflict' };
  }
  if (input.directPublishContentDigest
    && String(tracked.direct_publish_content_digest || '') !== input.directPublishContentDigest) {
    return { allow: false, reason: 'binding_conflict' };
  }
  if (tracked.direct_publish_account_id && tracked.direct_publish_account_id !== input.accountId) {
    return { allow: false, reason: 'binding_conflict' };
  }
  if (input.directPublishRequestHash
    && String(stats.directPublishRequestHash || '') !== input.directPublishRequestHash) {
    return { allow: false, reason: 'binding_conflict' };
  }
  const status = String(stats.status || '');
  if (tracked.reconciliation_required === true || status === 'needs_reconciliation') {
    return { allow: false, reason: 'needs_reconciliation' };
  }
  if (String(tracked.platform_post_id || '') || status === 'published') return { allow: false, reason: 'published' };
  if (status === 'publishing') return { allow: false, reason: 'publishing' };
  if (['voided', 'cancelled', 'on_hold', 'partial', 'scheduled'].includes(status)) return { allow: false, reason: 'closed' };
  return { allow: true };
}

function directReplayError(tracked: PostRecord, decision: Exclude<DirectPublishAdmission, { allow: true }>): Error {
  const unresolved = ['publishing', 'needs_reconciliation'].includes(decision.reason);
  const published = decision.reason === 'published';
  const classification: PlatformPublishFailureClassification = {
    disposition: unresolved ? 'outcome_unknown' : 'definitive_rejection',
    outcomeUnknown: unresolved,
    retrySafe: false,
    statusCode: decision.reason === 'binding_conflict' ? 422 : 409,
    reason: unresolved ? 'existing_unresolved_publish' : published ? 'already_published' : 'unclassified',
  };
  const error = publishError(
    unresolved
      ? '该幂等发布请求已有未决平台结果，必须先完成账号对账'
      : published
        ? '该幂等发布请求已经成功，禁止重复提交平台'
        : decision.reason === 'closed'
          ? '该内容围栏已人工作废或关闭，不能直接重放'
          : '幂等发布键已绑定到其他账号或平台',
    classification.statusCode || 409,
  );
  return withPublishFailureContext(error, tracked, classification, decision.reason === 'needs_reconciliation');
}

function admitExistingDirectPublish(input: PublishToAccountInput, tracked: PostRecord): PostRecord {
  const decision = directPublishAdmission(input, tracked);
  if (!decision.allow) throw directReplayError(tracked, decision);
  return tracked;
}

async function admitOrRebindFailedDirectPublish(
  input: PublishToAccountInput,
  tracked: PostRecord,
  dataStore: DataStore,
  idempotencyKey: string,
): Promise<PostRecord> {
  const decision = directPublishAdmission(input, tracked);
  if (decision.allow) return tracked;
  const stats = jsonObject(tracked.stats);
  const bindingWithoutRequestHash = directPublishAdmission(
    { ...input, directPublishRequestHash: undefined },
    tracked,
  );
  const requestHashChanged = String(stats.directPublishRequestHash || '') !== input.directPublishRequestHash;
  const safelyFailed = stats.source === 'manual' && stats.directPublish === true && stats.status === 'failed'
    && tracked.reconciliation_required !== true && !String(tracked.platform_post_id || '');
  if (decision.reason !== 'binding_conflict' || !bindingWithoutRequestHash.allow
    || !requestHashChanged || !safelyFailed || !input.directPublishRequestHash) {
    throw directReplayError(tracked, decision);
  }
  const revision = Number(tracked.publish_revision || 0);
  const rebound = await compareAndSetRecord<PostRecord>({
    store: dataStore,
    collection: 'posts',
    id: tracked.id,
    expected: {
      publish_revision: revision,
      digital_employee_idempotency_key: tracked.digital_employee_idempotency_key || '',
      direct_publish_fence_key: input.directPublishFenceKey || '',
      platform_post_id: tracked.platform_post_id || '',
      reconciliation_required: false,
    },
    patch: withPublishQueueProjection(tracked, {
      digital_employee_idempotency_key: idempotencyKey,
      stats: { ...stats, directPublishRequestHash: input.directPublishRequestHash },
      publish_revision: revision + 1,
    }),
  });
  if (rebound.ok) return rebound.record;
  const current = await dataStore.getById<PostRecord>('posts', tracked.id);
  if (current) return admitExistingDirectPublish(input, current);
  throw publishError('direct_publish_failed_rebind_conflict', 409);
}

export type DirectPublishReservationDependencies = {
  dataStore: DataStore;
  createDraft: (tenantId: string, input: PostDraftInput) => Promise<PostRecord>;
};

const defaultReservationDependencies: DirectPublishReservationDependencies = {
  dataStore: store,
  createDraft: (tenantId, input) => createTrackedPostDraft(tenantId, input),
};

async function trackingPost(
  input: PublishToAccountInput,
  dependencies: DirectPublishReservationDependencies = defaultReservationDependencies,
): Promise<PostRecord> {
  if (input.trackingPost) {
    if (input.trackingPost.tenant_id !== input.tenantId) throw publishError('Scheduled post does not belong to this tenant', 404);
    if (input.trackingPost.platform && input.trackingPost.platform !== input.platform) throw publishError('Scheduled post platform does not match target account', 400);
    return input.trackingPost;
  }
  const idempotencyKey = String(input.idempotencyKey || '').trim().slice(0, 200);
  if (!idempotencyKey) throw publishError('direct_publish_idempotency_key_required', 400);
  const fenceKey = String(input.directPublishFenceKey || '').trim();
  const contentDigest = String(input.directPublishContentDigest || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fenceKey) || !/^[a-f0-9]{64}$/.test(contentDigest)) {
    throw publishError('direct_publish_content_fence_required', 400);
  }
  input.directPublishRequestHash = input.directPublishRequestHash || directPublishRequestHash(input);
  const reservation = await reservePublishContentFences({
    dataStore: dependencies.dataStore,
    tenantId: input.tenantId,
    platform: input.platform,
    accountIds: [input.accountId],
    contentDigest,
    ownerKey: idempotencyKey,
    allowFailedDirectReuse: true,
  });
  try {
    const linked = reservation.linkedPosts[0];
    if (linked) return admitOrRebindFailedDirectPublish(input, linked, dependencies.dataStore, idempotencyKey);
    const existing = await dependencies.dataStore.list<PostRecord>('posts', {
      where: { tenant_id: input.tenantId, digital_employee_idempotency_key: idempotencyKey },
      perPage: 1,
    });
    if (existing.items[0]) {
      const admitted = await admitOrRebindFailedDirectPublish(input, existing.items[0], dependencies.dataStore, idempotencyKey);
      await attachPublishContentFences(dependencies.dataStore, reservation.records, idempotencyKey, admitted.id);
      return admitted;
    }
    const fenced = await dependencies.dataStore.list<PostRecord>('posts', {
      where: { tenant_id: input.tenantId, direct_publish_fence_key: fenceKey },
      perPage: 1,
    });
    if (fenced.items[0]) {
      const admitted = await admitOrRebindFailedDirectPublish(input, fenced.items[0], dependencies.dataStore, idempotencyKey);
      await attachPublishContentFences(dependencies.dataStore, reservation.records, idempotencyKey, admitted.id);
      return admitted;
    }
    const created = await dependencies.createDraft(input.tenantId, {
      contentId: input.contentId,
      platform: input.platform,
      title: input.title,
      language: input.language,
      enabled: input.trackWaLink !== false,
      digitalEmployeeIdempotencyKey: idempotencyKey,
      directPublishFenceKey: fenceKey,
      directPublishContentDigest: contentDigest,
      directPublishAccountId: input.accountId,
      directPublishRequestHash: input.directPublishRequestHash,
    });
    const admitted = await admitOrRebindFailedDirectPublish(input, created, dependencies.dataStore, idempotencyKey);
    await attachPublishContentFences(dependencies.dataStore, reservation.records, idempotencyKey, admitted.id);
    return admitted;
  } catch (initialError) {
    let recoveryError: unknown = initialError;
    try {
      const racedByIdempotency = await dependencies.dataStore.list<PostRecord>('posts', {
        where: { tenant_id: input.tenantId, digital_employee_idempotency_key: idempotencyKey },
        perPage: 1,
      });
      if (racedByIdempotency.items[0]) {
        const admitted = await admitOrRebindFailedDirectPublish(input, racedByIdempotency.items[0], dependencies.dataStore, idempotencyKey);
        await attachPublishContentFences(dependencies.dataStore, reservation.records, idempotencyKey, admitted.id);
        return admitted;
      }
      const racedByFence = await dependencies.dataStore.list<PostRecord>('posts', {
        where: { tenant_id: input.tenantId, direct_publish_fence_key: fenceKey },
        perPage: 1,
      });
      if (racedByFence.items[0]) {
        const admitted = await admitOrRebindFailedDirectPublish(input, racedByFence.items[0], dependencies.dataStore, idempotencyKey);
        await attachPublishContentFences(dependencies.dataStore, reservation.records, idempotencyKey, admitted.id);
        return admitted;
      }
    } catch (error) {
      recoveryError = error;
    }
    // This also runs when a recovery candidate exists but admission rejects it;
    // otherwise a failed direct request can strand an unlinked reservation.
    await releasePublishContentReservations(dependencies.dataStore, reservation.createdIds, idempotencyKey).catch(() => undefined);
    throw recoveryError;
  }
}

function directPublishLeaseMs(): number {
  const configured = Number(process.env.PUBLISH_ACCOUNT_TIMEOUT_MS || 10 * 60_000);
  const timeoutMs = Number.isFinite(configured) && configured > 0 ? Math.max(30_000, configured) : 10 * 60_000;
  return Math.max(15 * 60_000, timeoutMs + 60_000);
}

async function beginDirectPublishAttempt(
  input: PublishToAccountInput,
  tracked: PostRecord,
  dataStore: DataStore = store,
): Promise<PostRecord> {
  if (input.finalizeTracking === false) return tracked;
  const stats = jsonObject(tracked.stats);
  const now = new Date().toISOString();
  const revision = Number(tracked.publish_revision || 0);
  const leaseOwner = `direct-publish:${tracked.id}:${revision + 1}`;
  const operationId = input.publishOperationId || newPublishOperationId();
  input.publishOperationId = operationId;
  const changed = await compareAndSetRecord<PostRecord>({
    store: dataStore,
    collection: 'posts',
    id: tracked.id,
    expected: {
      publish_revision: revision,
      publish_lease_owner: tracked.publish_lease_owner || '',
      publish_lease_expires_at: tracked.publish_lease_expires_at || '',
      digital_employee_fence_revision: Number(tracked.digital_employee_fence_revision || 0),
      publish_operation_id: tracked.publish_operation_id || '',
      direct_publish_fence_key: input.directPublishFenceKey || '',
    },
    patch: withPublishQueueProjection(tracked, {
      stats: {
        ...stats,
        source: 'manual',
        status: 'publishing',
        targetAccountIds: [input.accountId],
        targetAccountLabels: [input.accountId],
        publishResults: {},
        publishAttempts: Number(stats.publishAttempts || 0) + 1,
        lastPublishAttemptAt: now,
        nextPublishAttemptAt: '',
        publishError: '',
        warnings: [],
        description: input.description || '',
        videoPath: input.videoPath || '',
        videoUrl: input.videoUrl || '',
        language: input.language || '',
        trackWaLink: input.trackWaLink !== false,
        directPublish: true,
        directPublishContentDigest: input.directPublishContentDigest || '',
        directPublishContentSource: input.directPublishContentSource || '',
        directPublishFenceKey: input.directPublishFenceKey || '',
        directPublishRequestHash: input.directPublishRequestHash || directPublishRequestHash(input),
      },
      publish_lease_owner: leaseOwner,
      publish_lease_expires_at: new Date(Date.now() + directPublishLeaseMs()).toISOString(),
      publish_revision: revision + 1,
      reconciliation_required: false,
      ...publishOperationStartPatch(operationId),
    }),
  });
  if (!changed.ok) {
    const current = await dataStore.getById<PostRecord>('posts', tracked.id);
    if (current) {
      const decision = directPublishAdmission(input, current);
      if (!decision.allow) throw directReplayError(current, decision);
    }
    throw publishError('direct_publish_reservation_conflict', 423);
  }
  Object.assign(tracked, changed.record);
  return tracked;
}

/**
 * Atomically reserves the only provider call permitted for a direct content
 * fence. Tests inject an in-memory store; production uses PocketBase CAS.
 */
export async function reserveDirectPublishAttempt(
  input: PublishToAccountInput,
  dependencies: DirectPublishReservationDependencies = defaultReservationDependencies,
): Promise<PostRecord> {
  const tracked = await trackingPost(input, dependencies);
  return beginDirectPublishAttempt(input, tracked, dependencies.dataStore);
}

async function updateDirectOperationState(
  postId: string,
  operationId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await persistPublishOperationTransition({
    store,
    postId,
    operationId,
    patch,
  });
}

async function persistDirectProviderOperationEvidence(
  input: PublishToAccountInput,
  tracked: PostRecord,
  providerHandle: string,
): Promise<void> {
  const operationId = String(input.publishOperationId || tracked.publish_operation_id || '');
  if (!operationId) throw publishError('direct_publish_operation_fence_missing', 500);
  const leaseOwner = String(tracked.publish_lease_owner || '');
  try {
    const persisted = await persistProviderOperationEvidence({
      store,
      postId: tracked.id,
      tenantId: input.tenantId,
      platform: input.platform,
      operationId,
      accountId: input.accountId,
      handle: providerHandle,
      leaseOwner,
      leaseExtensionMs: directPublishLeaseMs(),
    });
    Object.assign(tracked, persisted.record);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'provider_operation_evidence_persistence_conflict';
    throw publishError(message, 409);
  }
}

async function captureProviderOperationId(
  input: PublishToAccountInput,
  tracked: PostRecord,
  providerHandle: string,
): Promise<void> {
  const reference = providerOperationAuditReference(input.platform, providerHandle);
  input.providerOperationId = reference;
  if (input.finalizeTracking !== false) {
    await persistDirectProviderOperationEvidence(input, tracked, providerHandle);
  }
  await input.onProviderOperationId?.(providerHandle);
}

async function runDirectProviderOperation<T>(
  input: PublishToAccountInput,
  tracked: PostRecord,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const operationId = String(input.publishOperationId || tracked.publish_operation_id || '');
  if (!operationId) throw publishError('direct_publish_operation_fence_missing', 500);
  const timeoutMs = publishTransportTimeoutMs(input.transportTimeoutMs);
  try {
    return await runAbortablePublishOperation(work, {
      timeoutMs,
      onTimeout: () => updateDirectOperationState(tracked.id, operationId, publishOperationQuiescingPatch(operationId)),
      onSettled: settledAfterTimeout => updateDirectOperationState(
        tracked.id,
        operationId,
        publishOperationQuiescedPatch(operationId, { requireCooldown: settledAfterTimeout }),
      ),
    });
  } catch (error) {
    if (input.providerOperationId && error && typeof error === 'object' && Object.isExtensible(error)) {
      Object.assign(error, { providerOperationId: input.providerOperationId });
    }
    throw error;
  }
}

async function finalizeDirectPublish(
  input: PublishToAccountInput,
  tracked: PostRecord,
  platformPostId: string,
  providerOperationId = '',
): Promise<void> {
  if (input.finalizeTracking === false) return;
  const now = new Date().toISOString();
  const stats = jsonObject(tracked.stats);
  const results = stats.publishResults && typeof stats.publishResults === 'object' && !Array.isArray(stats.publishResults)
    ? { ...(stats.publishResults as Record<string, DirectPublishResult>) }
    : {};
  results[input.accountId] = {
    status: 'published',
    platformPostId,
    publishedAt: now,
    ...(providerOperationId ? { providerOperationId } : {}),
  };
  const changed = await compareAndSetRecord<PostRecord>({
    store,
    collection: 'posts',
    id: tracked.id,
    expected: {
      publish_revision: Number(tracked.publish_revision || 0),
      publish_lease_owner: tracked.publish_lease_owner || '',
      digital_employee_fence_revision: Number(tracked.digital_employee_fence_revision || 0),
      publish_operation_id: input.publishOperationId || tracked.publish_operation_id || '',
    },
    patch: withPublishQueueProjection(tracked, {
      platform_post_id: platformPostId,
      title: input.title,
      published_at: now,
      stats: {
        ...stats,
        status: 'published',
        publishResults: results,
        publishedAt: now,
        publishError: '',
        nextPublishAttemptAt: '',
        warnings: [],
      },
      publish_lease_owner: '',
      publish_lease_expires_at: '',
      publish_revision: Number(tracked.publish_revision || 0) + 1,
      reconciliation_required: false,
      ...publishOperationQuiescedPatch(input.publishOperationId || tracked.publish_operation_id || ''),
    }),
  });
  if (changed.ok) {
    Object.assign(tracked, changed.record);
    return;
  }
  const current = await store.getById<PostRecord>('posts', tracked.id);
  if (current && String(current.platform_post_id || '') === platformPostId
    && jsonObject(current.stats).status === 'published') {
    Object.assign(tracked, current);
    return;
  }
  throw publishError('平台已返回成功，但发布结果未能可靠持久化', 502);
}

export function directPublishFailureStatePatch(input: {
  tracked: PostRecord;
  accountId: string;
  classification: PlatformPublishFailureClassification;
  message: string;
  now?: string;
  operationTimedOut?: boolean;
  providerOperationId?: string;
}): Record<string, unknown> {
  const stats = jsonObject(input.tracked.stats);
  const now = input.now || new Date().toISOString();
  const operationId = String(input.tracked.publish_operation_id || '');
  const results = stats.publishResults && typeof stats.publishResults === 'object' && !Array.isArray(stats.publishResults)
    ? { ...(stats.publishResults as Record<string, DirectPublishResult>) }
    : {};
  results[input.accountId] = input.classification.outcomeUnknown ? {
    status: 'unknown',
    outcomeUnknown: true,
    error: input.message,
    failedAt: now,
    failureReason: input.classification.reason,
    ...(input.providerOperationId ? { providerOperationId: input.providerOperationId } : {}),
    ...(input.classification.statusCode !== null ? { httpStatus: input.classification.statusCode } : {}),
  } : {
    status: 'failed',
    error: input.message,
    failedAt: now,
    failureReason: input.classification.reason,
    ...(input.providerOperationId ? { providerOperationId: input.providerOperationId } : {}),
    ...(input.classification.statusCode !== null ? { httpStatus: input.classification.statusCode } : {}),
  };
  return withPublishQueueProjection(input.tracked, {
    stats: {
      ...stats,
      source: 'manual',
      status: input.classification.outcomeUnknown ? 'needs_reconciliation' : 'failed',
      targetAccountIds: Array.isArray(stats.targetAccountIds) && stats.targetAccountIds.length
        ? stats.targetAccountIds
        : [input.accountId],
      targetAccountLabels: Array.isArray(stats.targetAccountLabels) && stats.targetAccountLabels.length
        ? stats.targetAccountLabels
        : [input.accountId],
      publishResults: results,
      publishError: input.message,
      warnings: [input.message],
      nextPublishAttemptAt: '',
      outcomeUnknown: input.classification.outcomeUnknown,
      ...(input.classification.outcomeUnknown ? {
        reconciliationReason: 'direct_platform_publish_outcome_unknown',
        reconciliationStartedAt: now,
      } : {}),
    },
    publish_lease_owner: '',
    publish_lease_expires_at: '',
    publish_revision: Number(input.tracked.publish_revision || 0) + 1,
    digital_employee_fence_revision: Number(input.tracked.digital_employee_fence_revision || 0) + (input.classification.outcomeUnknown ? 1 : 0),
    reconciliation_required: input.classification.outcomeUnknown,
    ...(operationId
      ? input.operationTimedOut && input.tracked.publish_operation_state !== 'quiesced'
        ? publishOperationQuiescingPatch(operationId)
        : publishOperationQuiescedPatch(operationId, {
          now: Date.parse(now), requireCooldown: input.classification.outcomeUnknown,
        })
      : {}),
  });
}

async function persistDirectPublishFailure(
  input: PublishToAccountInput,
  tracked: PostRecord,
  error: unknown,
  classification: PlatformPublishFailureClassification,
): Promise<{ persisted: boolean; observedPublished: boolean }> {
  if (input.finalizeTracking === false) return { persisted: false, observedPublished: false };
  const message = publishFailureMessage(error);
  const operationId = input.publishOperationId || tracked.publish_operation_id || '';
  const operationTimedOut = Boolean(error && typeof error === 'object'
    && (error as { publishOperationTimedOut?: unknown }).publishOperationTimedOut === true);
  const providerOperationId = providerOperationAuditReference(
    input.platform,
    String((error as { providerOperationId?: unknown } | null)?.providerOperationId
      || input.providerOperationId || ''),
  );
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await store.getById<PostRecord>('posts', tracked.id);
      if (!current || current.publish_operation_id !== operationId) break;
      const currentStatus = String(jsonObject(current.stats).status || '');
      if (currentStatus === 'published') {
        Object.assign(tracked, current);
        return { persisted: true, observedPublished: true };
      }
      if (current.reconciliation_required === true || currentStatus === 'failed') {
        Object.assign(tracked, current);
        return { persisted: true, observedPublished: false };
      }
      if (Number(current.publish_revision || 0) !== Number(tracked.publish_revision || 0)) break;
      Object.assign(tracked, current);
      const patch = directPublishFailureStatePatch({
        tracked,
        accountId: input.accountId,
        classification,
        message,
        operationTimedOut,
        providerOperationId,
      });
      const changed = await compareAndSetRecord<PostRecord>({
        store,
        collection: 'posts',
        id: tracked.id,
        expected: {
          publish_revision: Number(tracked.publish_revision || 0),
          publish_lease_owner: tracked.publish_lease_owner || '',
          digital_employee_fence_revision: Number(tracked.digital_employee_fence_revision || 0),
          publish_operation_id: operationId,
          publish_operation_state: tracked.publish_operation_state || '',
        },
        patch,
      });
      if (changed.ok) {
        Object.assign(tracked, changed.record);
        return { persisted: true, observedPublished: false };
      }
    }
  } catch (persistenceError) {
    console.error('[publishing] direct publish failure state persistence failed:', persistenceError);
  }
  return { persisted: false, observedPublished: false };
}

function withPublishFailureContext(
  error: unknown,
  tracked: PostRecord,
  classification: PlatformPublishFailureClassification,
  reconciliationPersisted: boolean,
): Error & PlatformPublishFailureContext {
  const base = error instanceof Error && Object.isExtensible(error)
    ? error
    : Object.assign(new Error(publishFailureMessage(error)), { cause: error });
  return Object.assign(base, {
    ...(classification.statusCode !== null ? { statusCode: classification.statusCode } : {}),
    trackingPostId: tracked.id,
    reconciliationPersisted,
    outcomeUnknown: classification.outcomeUnknown,
    publishFailureClassification: classification,
  });
}

export function platformPublishFailureContext(error: unknown): PlatformPublishFailureContext | null {
  if (!error || typeof error !== 'object') return null;
  const value = error as Partial<PlatformPublishFailureContext>;
  if (!value.trackingPostId) return null;
  return {
    trackingPostId: String(value.trackingPostId),
    reconciliationPersisted: value.reconciliationPersisted === true,
    outcomeUnknown: value.outcomeUnknown === true,
  };
}

function validateLocalVideo(tenantId: string, videoPath: string | undefined, extensions: string[], maxMb: number): string {
  if (!videoPath) throw publishError('缺少待发布的视频文件', 400);
  const resolved = resolveTenantPublishingVideo(tenantId, videoPath, { extensions });
  if (!resolved) throw publishError('待发布视频不属于当前企业或文件不存在', 400);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw publishError('视频路径不是文件', 400);
  if (stat.size > maxMb * 1024 * 1024) throw publishError(`视频超过 ${maxMb}MB`, 413);
  return resolved;
}

async function probeVideoDurationSeconds(filePath: string, signal?: AbortSignal): Promise<number> {
  if (!ffmpegStatic) throw localPublishPreparationError('视频时长校验工具不可用');
  let diagnostic = '';
  try {
    const result = await execFileAsync(String(ffmpegStatic), ['-hide_banner', '-nostdin', '-i', filePath], {
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
      signal,
    });
    diagnostic = String(result.stderr || result.stdout || '');
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    const candidate = error as { stderr?: unknown; stdout?: unknown };
    diagnostic = String(candidate.stderr || candidate.stdout || '');
  }
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i.exec(diagnostic);
  if (!match) throw localPublishPreparationError('无法读取 TikTok 视频时长，请重新合成成片', 400);
  const duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  if (!Number.isFinite(duration) || duration <= 0) throw localPublishPreparationError('TikTok 视频时长无效', 400);
  return duration;
}

function socialVideoContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.webm') return 'video/webm';
  return 'video/mp4';
}

function socialPublishObjectStorageClient(): { client: S3Client; bucket: string } {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const endpoint = process.env.OBJECT_STORAGE_ENDPOINT?.trim()
    || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
  const accessKeyId = (process.env.OBJECT_STORAGE_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID)?.trim();
  const secretAccessKey = (process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY)?.trim();
  const bucket = (process.env.OBJECT_STORAGE_BUCKET_NAME || process.env.R2_BUCKET_NAME || '').trim();
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw localPublishPreparationError('Instagram 发布对象存储配置不完整');
  }
  return {
    client: new S3Client({
      endpoint,
      region: process.env.OBJECT_STORAGE_REGION?.trim() || 'auto',
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket,
  };
}

async function streamSocialPublishObject(input: {
  key: string;
  filePath: string;
  signal?: AbortSignal;
}): Promise<string> {
  const publicBase = process.env.R2_PUBLIC_URL?.trim().replace(/\/$/, '');
  if (!publicBase) throw localPublishPreparationError('Instagram 发布需要配置 R2_PUBLIC_URL');
  const stat = fs.statSync(input.filePath);
  const { client, bucket } = socialPublishObjectStorageClient();
  const stream = fs.createReadStream(input.filePath);
  const abortStream = () => stream.destroy(input.signal?.reason instanceof Error
    ? input.signal.reason
    : Object.assign(new Error('upload_aborted'), { code: 'ERR_CANCELED' }));
  input.signal?.addEventListener('abort', abortStream, { once: true });
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: input.key,
      Body: stream,
      ContentLength: stat.size,
      ContentType: socialVideoContentType(input.filePath),
    }), { abortSignal: input.signal });
  } catch (error) {
    if (input.signal?.aborted) throw input.signal.reason || error;
    throw localPublishPreparationError(
      `Instagram 公网视频上传失败：${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    input.signal?.removeEventListener('abort', abortStream);
    if (!stream.destroyed) stream.destroy();
    client.destroy();
  }
  return `${publicBase}/${input.key}`;
}

async function publicVideoUrlIfNeeded(
  tenantId: string,
  filePath: string | undefined,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (!filePath) return undefined;
  const publicBase = process.env.R2_PUBLIC_URL?.trim();
  if (!publicBase || !fs.existsSync(filePath)) return undefined;
  const identity = await tenantPublishingVideoSha256(tenantId, filePath, { extensions: ['.mp4'] });
  const safeTenant = tenantId.replace(/[^A-Za-z0-9._-]+/g, '-');
  const key = `social-publish/${safeTenant}/instagram-v1/${identity.sha256}.mp4`;
  return streamSocialPublishObject({ key, filePath: identity.filePath, signal });
}

async function instagramCompatibleVideo(
  tenantId: string,
  filePath: string | undefined,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (!filePath) return undefined;
  const sourceIdentity = await tenantPublishingVideoSha256(tenantId, filePath, { extensions: ['.mp4', '.mov', '.webm'] });
  const parsed = path.parse(sourceIdentity.filePath);
  const outputPath = path.join(parsed.dir, `${parsed.name}.${sourceIdentity.sha256}.instagram-v1.mp4`);
  try {
    const outputStat = fs.statSync(outputPath);
    if (outputStat.isFile() && outputStat.size > 0) return outputPath;
  } catch {
    // Build a platform-compatible derivative below.
  }
  const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp.mp4`;
  try {
    await execFileAsync(String(ffmpegStatic), [
      '-hide_banner',
      '-loglevel', 'error',
      '-nostdin',
      '-y',
      '-i', sourceIdentity.filePath,
      '-filter_complex',
      '[0:v]split=2[background][foreground];'
        + '[background]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,boxblur=20:10[background_ready];'
        + '[foreground]scale=720:1280:force_original_aspect_ratio=decrease[foreground_ready];'
        + '[background_ready][foreground_ready]overlay=(W-w)/2:(H-h)/2,format=yuv420p[video]',
      '-map', '[video]',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-profile:v', 'high',
      '-level:v', '4.0',
      '-preset', 'medium',
      '-crf', '20',
      '-maxrate', '8M',
      '-bufsize', '16M',
      '-r', '30',
      '-g', '60',
      '-keyint_min', '60',
      '-sc_threshold', '0',
      '-flags', '+cgop',
      '-c:a', 'aac',
      '-profile:a', 'aac_low',
      '-ar', '48000',
      '-ac', '2',
      '-b:a', '128k',
      '-movflags', '+faststart',
      temporaryPath,
    ], { timeout: 15 * 60_000, maxBuffer: 8 * 1024 * 1024, signal });
    const afterTransform = await tenantPublishingVideoSha256(
      tenantId,
      sourceIdentity.filePath,
      { extensions: ['.mp4', '.mov', '.webm'] },
    );
    if (afterTransform.sha256 !== sourceIdentity.sha256) {
      throw localPublishPreparationError('Instagram 转码期间源视频发生变化');
    }
    fs.renameSync(temporaryPath, outputPath);
    return outputPath;
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* best effort */ }
    if (signal?.aborted) throw signal.reason || error;
    if (error && typeof error === 'object' && 'publishFailureClassification' in error) throw error;
    throw localPublishPreparationError(`Instagram 兼容视频生成失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function platformContentId(video: any): string {
  return String(video?.id || video?.videoId || video?.publishId || '').trim();
}

export async function publishVideoToAccount(input: PublishToAccountInput): Promise<PublishToAccountResult> {
  if (!input.title.trim()) throw publishError('发布标题不能为空', 400);
  if (input.platform === 'youtube') {
    const account = await store.getById<YouTubeAccountRecord>('youtube_accounts', input.accountId);
    if (!account || account.tenantId !== input.tenantId) throw publishError('YouTube account not found', 404);
    if (account.status !== 'connected') throw publishError('YouTube account is not connected', 400);
    const credentials = await youtubeAccountCredentials(account).catch(() => {
      throw publishError('YouTube account credentials require reconnection', 409);
    });
    const privacyStatus = input.privacyStatus || 'unlisted';
    if (!['private', 'unlisted', 'public'].includes(privacyStatus)) throw publishError('Invalid YouTube privacy status', 400);
    const filePath = validateLocalVideo(input.tenantId, input.videoPath, ['.mp4', '.mov', '.webm', '.mkv', '.avi'], Number(process.env.YOUTUBE_MAX_UPLOAD_MB ?? 2048));
    const direct = !input.trackingPost && input.finalizeTracking !== false;
    if (direct) {
      const identity = await tenantPublishingVideoSha256(input.tenantId, filePath, { extensions: ['.mp4', '.mov', '.webm', '.mkv', '.avi'] });
      const boundInput: PublishToAccountInput = {
        ...input,
        videoPath: identity.filePath,
        privacyStatus,
        directPublishContentDigest: identity.sha256,
        directPublishContentSource: 'local_sha256',
        directPublishFenceKey: publishContentFenceKey({
          tenantId: input.tenantId, platform: input.platform, accountId: input.accountId, contentDigest: identity.sha256,
        }),
      };
      input = { ...boundInput, directPublishRequestHash: directPublishRequestHash(boundInput) };
    }
    let tracked = direct ? await reserveDirectPublishAttempt(input) : await trackingPost(input);
    if (!direct) tracked = await beginDirectPublishAttempt(input, tracked);
    const description = appendTrackedWaLink('youtube', input.description || '', tracked.wa_link || '');
    const config: YouTubeConfig = {
      clientId: account.clientId,
      clientSecret: credentials.clientSecret,
      refreshToken: credentials.refreshToken,
      accessToken: credentials.accessToken,
    };
    try {
      const upload = (signal?: AbortSignal) => uploadVideoToYouTube(config, {
        filePath,
        title: input.title,
        description,
        tags: parseTags(input.tags, description),
        privacyStatus,
        madeForKids: input.madeForKids ?? false,
      }, {
        signal: signal || input.signal,
        timeoutMs: publishTransportTimeoutMs(input.transportTimeoutMs),
        onProviderOperationId: providerOperationId => captureProviderOperationId(input, tracked, providerOperationId),
      });
      const video = direct ? await runDirectProviderOperation(input, tracked, upload) : await upload(input.signal);
      const id = platformContentId(video);
      if (!id) throw publishError('YouTube did not return a video id', 502);
      const providerOperationId = providerOperationAuditReference(
        input.platform,
        String((video as { providerOperationId?: unknown })?.providerOperationId || input.providerOperationId || ''),
      );
      await finalizeDirectPublish(input, tracked, id, providerOperationId);
      await store.update('youtube_accounts', input.accountId, { lastSyncAt: new Date().toISOString(), status: 'connected' })
        .catch(error => console.error('[publishing] YouTube account sync update failed:', error));
      let publishRecord: ReturnType<typeof recordSuccessfulPublish> | null = null;
      try {
        publishRecord = recordSuccessfulPublish({
          tenantId: input.tenantId,
          platform: 'youtube',
          accountId: input.accountId,
          platformContentId: id,
          projectId: input.projectId,
          generationVersionId: input.generationVersionId,
          title: input.title,
          description: input.description || '',
          videoPath: input.videoPath,
          ratio: input.ratio,
          language: input.language,
        });
      } catch (error) {
        console.error('[publishing] YouTube history write failed:', error);
      }
      return {
        video,
        tracking: tracked,
        publishRecord,
        platformPostId: id,
        ...(providerOperationId ? { providerOperationId } : {}),
      };
    } catch (error) {
      const status = accountStatus(error);
      if (status === 401 || status === 403) {
        await store.update('youtube_accounts', input.accountId, { status: 'error' })
          .catch(updateError => console.error('[publishing] YouTube account error-state update failed:', updateError));
      }
      const classification = classifyPlatformPublishFailure(error);
      const persistence = await persistDirectPublishFailure(input, tracked, error, classification);
      const effectiveClassification: PlatformPublishFailureClassification = persistence.observedPublished ? {
        disposition: 'definitive_rejection', outcomeUnknown: false, retrySafe: false,
        statusCode: 409, reason: 'already_published',
      } : classification;
      throw withPublishFailureContext(error, tracked, effectiveClassification, persistence.persisted);
    }
  }

  const account = await store.getById<SocialAccountRecord>('social_accounts', input.accountId);
  if (!account || account.tenantId !== input.tenantId || account.platform !== input.platform) throw publishError('Social account not found', 404);
  if (account.status !== 'connected') throw publishError('Social account is not connected', 400);
  const credentials = await socialAccountCredentials(account).catch(() => {
    throw publishError('Social account credentials require reconnection', 409);
  });
  const filePath = input.videoPath
    ? validateLocalVideo(input.tenantId, input.videoPath, ['.mp4', '.mov', '.webm'], Number(process.env.SOCIAL_MAX_UPLOAD_MB ?? 2048))
    : undefined;
  const normalizedVideoUrl = input.videoUrl ? normalizeApprovedPublicVideoUrl(input.videoUrl) || undefined : undefined;
  if (input.videoUrl && !normalizedVideoUrl) throw publishError('公开视频地址不在允许的 HTTPS 来源中', 400);
  // A URL is a locator, not an immutable content identity. Real publishing is
  // bound to locally hashed bytes; providers that need a URL receive an upload
  // derived from that same local file below.
  if (!filePath && normalizedVideoUrl) throw publishError('immutable_local_video_required', 400);
  const approvedVideoUrl = filePath ? undefined : normalizedVideoUrl;
  if (!filePath && !approvedVideoUrl) throw publishError('缺少待发布的视频文件或公开视频地址', 400);
  if (account.platform === 'instagram' && !approvedVideoUrl && !process.env.R2_PUBLIC_URL?.trim()) {
    throw publishError('Instagram 发布需要配置 R2_PUBLIC_URL 或提供公开视频地址', 400);
  }
  const direct = !input.trackingPost && input.finalizeTracking !== false;
  if (direct) {
    const identity = filePath
      ? await tenantPublishingVideoSha256(input.tenantId, filePath, { extensions: ['.mp4', '.mov', '.webm'] })
      : { filePath: '', sha256: approvedUrlContentDigest(approvedVideoUrl || '') };
    const effectivePrivacyStatus = account.platform === 'tiktok'
      ? input.tiktokPublishOptions?.privacyLevel === 'PUBLIC_TO_EVERYONE' ? 'public' : 'private'
      : account.platform === 'instagram'
        ? 'public'
        : input.privacyStatus === 'private' ? 'private' : 'public';
    const boundInput: PublishToAccountInput = {
      ...input,
      videoPath: identity.filePath || undefined,
      videoUrl: approvedVideoUrl,
      privacyStatus: effectivePrivacyStatus,
      directPublishContentDigest: identity.sha256,
      directPublishContentSource: filePath ? 'local_sha256' : 'approved_url',
      directPublishFenceKey: publishContentFenceKey({
        tenantId: input.tenantId, platform: input.platform, accountId: input.accountId, contentDigest: identity.sha256,
      }),
    };
    input = { ...boundInput, directPublishRequestHash: directPublishRequestHash(boundInput) };
  }
  let tracked = direct ? await reserveDirectPublishAttempt(input) : await trackingPost(input);
  if (!direct) tracked = await beginDirectPublishAttempt(input, tracked);
  const baseSocialInput: SocialUploadInput = {
    filePath,
    videoUrl: approvedVideoUrl,
    title: input.title,
    description: appendTrackedWaLink(account.platform, input.description || '', tracked.wa_link || ''),
    privacyStatus: input.privacyStatus,
    tiktokPublishOptions: input.tiktokPublishOptions,
    onProviderOperationId: providerOperationId => captureProviderOperationId(input, tracked, providerOperationId),
  };
  try {
    const upload = async (signal?: AbortSignal): Promise<unknown> => {
      const socialInput: SocialUploadInput = {
        ...baseSocialInput,
        signal: signal || input.signal,
        timeoutMs: publishTransportTimeoutMs(input.transportTimeoutMs),
      };
      if (account.platform === 'tiktok') {
        return uploadTikTokVideo(credentials.accessToken, {
          ...socialInput,
          videoDurationSeconds: await probeVideoDurationSeconds(filePath!, socialInput.signal),
        });
      }
      if (account.platform === 'facebook') return uploadFacebookVideo(account.providerAccountId, credentials.accessToken, process.env.META_GRAPH_VERSION?.trim() || 'v25.0', socialInput);
      if (account.platform === 'instagram') {
        const compatibleFilePath = socialInput.videoUrl
          ? undefined
          : await instagramCompatibleVideo(input.tenantId, filePath, socialInput.signal);
        return publishInstagramReel(account.providerAccountId, credentials.accessToken, process.env.META_GRAPH_VERSION?.trim() || 'v25.0', {
          ...socialInput,
          filePath: compatibleFilePath,
          videoUrl: socialInput.videoUrl
            || await publicVideoUrlIfNeeded(input.tenantId, compatibleFilePath, socialInput.signal),
        });
      }
      throw publishError('unsupported_social_platform', 400);
    };
    const video = direct ? await runDirectProviderOperation(input, tracked, upload) : await upload(input.signal);
    const id = platformContentId(video);
    if (!video || !id) throw publishError('平台没有返回发布内容 id', 502);
    const providerOperationId = providerOperationAuditReference(
      input.platform,
      String((video as { providerOperationId?: unknown })?.providerOperationId || input.providerOperationId || ''),
    );
    await finalizeDirectPublish(input, tracked, id, providerOperationId);
    await store.update('social_accounts', input.accountId, { lastSyncAt: new Date().toISOString(), status: 'connected' })
      .catch(error => console.error(`[publishing] ${account.platform} account sync update failed:`, error));
    let publishRecord: ReturnType<typeof recordSuccessfulPublish> | null = null;
    try {
      publishRecord = recordSuccessfulPublish({
        tenantId: input.tenantId,
        platform: account.platform,
        accountId: input.accountId,
        platformContentId: id,
        projectId: input.projectId,
        generationVersionId: input.generationVersionId,
        title: input.title,
        description: input.description || '',
        videoPath: input.videoPath,
        ratio: input.ratio,
        language: input.language,
      });
    } catch (error) {
      console.error(`[publishing] ${account.platform} history write failed:`, error);
    }
    return {
      video,
      tracking: tracked,
      publishRecord,
      platformPostId: id,
      ...(providerOperationId ? { providerOperationId } : {}),
    };
  } catch (error) {
    const status = accountStatus(error);
    if (status === 401 || status === 403) {
      await store.update('social_accounts', input.accountId, { status: 'error' })
        .catch(updateError => console.error(`[publishing] ${account.platform} account error-state update failed:`, updateError));
    }
    const classification = classifyPlatformPublishFailure(error);
    const persistence = await persistDirectPublishFailure(input, tracked, error, classification);
    const effectiveClassification: PlatformPublishFailureClassification = persistence.observedPublished ? {
      disposition: 'definitive_rejection', outcomeUnknown: false, retrySafe: false,
      statusCode: 409, reason: 'already_published',
    } : classification;
    throw withPublishFailureContext(error, tracked, effectiveClassification, persistence.persisted);
  }
}
