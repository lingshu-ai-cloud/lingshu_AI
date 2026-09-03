import type { PublishPlatform } from '../lib/publishHistory.js';
import type { TikTokPrivacyLevel, TikTokPublishOptions } from '../integrations/social.js';
import { store } from '../storage/index.js';
import { classifyPlatformPublishFailure, publishVideoToAccount } from './platformPublisher.js';
import type { PostRecord } from './waLink.js';
import { scheduledPostContentFencesAttached, verifyApprovedScheduledPost } from './scheduleService.js';
import { compareAndSetRecord, workerIdentity } from '../digitalEmployees/reliableKernel.js';
import { markWorkerStopped, recordWorkerHeartbeat, registerHealthCheck, registerWorkerHeartbeat } from '../ops/health.js';
import { incrementMetric, setGauge, structuredLog } from '../ops/observability.js';
import { tenantPublishingVideoSha256 } from './localVideoSecurity.js';
import type { DataStore } from '../storage/datastore.js';
import { listAllRecords } from '../storage/pagination.js';
import { reconcileStalePublishContentReservations } from './publishContentFence.js';
import { withPublishQueueProjection } from './publishQueueProjection.js';
import {
  newPublishOperationId,
  persistPublishOperationTransition,
  publishOperationQuiescedPatch,
  publishOperationQuiescingPatch,
  publishOperationStartPatch,
  reconciliationOperationBlock,
  runAbortablePublishOperation,
} from './publishOperationFence.js';
import {
  persistProviderOperationEvidence,
  providerOperationAuditReference,
  providerOperationEvidenceForAccount,
} from './providerOperationEvidence.js';

const POLL_INTERVAL_MS = 30_000;
const STALE_LOCK_MS = 15 * 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;
const SUPPORTED_PLATFORMS = new Set<PublishPlatform>(['youtube', 'tiktok', 'instagram', 'facebook']);
const configuredPublishLeaseMs = Number(process.env.PUBLISH_SCHEDULER_LEASE_MS || STALE_LOCK_MS);
const PUBLISH_LEASE_MS = Number.isFinite(configuredPublishLeaseMs) && configuredPublishLeaseMs > 0
  ? Math.max(60_000, configuredPublishLeaseMs)
  : STALE_LOCK_MS;
const configuredPublishAccountTimeoutMs = Number(process.env.PUBLISH_ACCOUNT_TIMEOUT_MS || 10 * 60_000);
const PUBLISH_ACCOUNT_TIMEOUT_MS = Number.isFinite(configuredPublishAccountTimeoutMs) && configuredPublishAccountTimeoutMs > 0
  ? Math.max(30_000, configuredPublishAccountTimeoutMs)
  : 10 * 60_000;
const ACTIVE_PUBLISH_LEASE_MS = Math.max(PUBLISH_LEASE_MS, PUBLISH_ACCOUNT_TIMEOUT_MS + 60_000);
const PUBLISH_WORKER_ID = workerIdentity('publishing-worker');
const PUBLISH_WORKER_NAME = 'scheduled-publisher';
const TIKTOK_PRIVACY_LEVELS = new Set<TikTokPrivacyLevel>([
  'PUBLIC_TO_EVERYONE',
  'MUTUAL_FOLLOW_FRIENDS',
  'FOLLOWER_OF_CREATOR',
  'SELF_ONLY',
]);

function boundedQueueBatchLimit(value: number, fallback: number): number {
  const normalized = Math.floor(Number(value));
  return Number.isFinite(normalized) ? Math.max(1, Math.min(500, normalized)) : fallback;
}

function queueCandidateReadLimit(batchLimit: number): number {
  return Math.min(500, Math.max(100, batchLimit * 5));
}

const QUEUE_SCAN_MAX_RECORDS = 5_000;

export type PublishResult = {
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

type GovernanceRecord = { id: string; [key: string]: unknown };
export type PublishGovernanceDecision = {
  ok: boolean;
  code?: string;
  disposition?: 'hold' | 'cancel' | 'reconcile';
};

export type ReconciliationReceipt = {
  accountId: string;
  outcome: 'published' | 'not_published';
  platformPostId: string;
  verifiedAt: string;
  evidence: string;
};

export type ReconciliationDecision = {
  action: 'confirm_published' | 'confirm_not_published_retry' | 'void';
  expectedRevision: number;
  note: string;
  receipts: ReconciliationReceipt[];
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function statsOf(post: PostRecord): Record<string, unknown> {
  if (post.stats && typeof post.stats === 'object' && !Array.isArray(post.stats)) return post.stats;
  if (typeof post.stats === 'string') {
    try {
      const parsed = JSON.parse(post.stats) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* invalid JSON is rejected by the caller */ }
  }
  return {};
}

export type ScheduledTikTokPublishOptions =
  | { ok: true; value: TikTokPublishOptions }
  | { ok: false; error: 'tiktok_publish_options_required' | 'tiktok_user_consent_required' | 'tiktok_publish_options_invalid' };

/**
 * Read the immutable, account-bound TikTok disclosure choices captured when
 * the schedule was approved. Never infer defaults: a missing choice or
 * consent must fail before a provider operation is opened.
 */
export function scheduledTikTokPublishOptionsForAccount(
  post: PostRecord,
  accountId: string,
): ScheduledTikTokPublishOptions {
  const byAccount = jsonObject(statsOf(post).tiktokPublishOptionsByAccount);
  if (!Object.prototype.hasOwnProperty.call(byAccount, accountId)) {
    return { ok: false, error: 'tiktok_publish_options_required' };
  }
  const candidate = jsonObject(byAccount[accountId]);
  if (candidate.userConsent !== true) {
    return { ok: false, error: 'tiktok_user_consent_required' };
  }
  const privacyLevel = candidate.privacyLevel as TikTokPrivacyLevel;
  const booleanFields = [
    'allowComment',
    'allowDuet',
    'allowStitch',
    'brandContentToggle',
    'brandOrganicToggle',
    'isAigc',
  ] as const;
  if (!TIKTOK_PRIVACY_LEVELS.has(privacyLevel)
    || booleanFields.some(field => typeof candidate[field] !== 'boolean')) {
    return { ok: false, error: 'tiktok_publish_options_invalid' };
  }
  return {
    ok: true,
    value: {
      privacyLevel,
      allowComment: candidate.allowComment as boolean,
      allowDuet: candidate.allowDuet as boolean,
      allowStitch: candidate.allowStitch as boolean,
      brandContentToggle: candidate.brandContentToggle as boolean,
      brandOrganicToggle: candidate.brandOrganicToggle as boolean,
      isAigc: candidate.isAigc as boolean,
      userConsent: true,
    },
  };
}

function targetAccountIdsOf(post: PostRecord): string[] {
  const stats = statsOf(post);
  return Array.isArray(stats.targetAccountIds)
    ? Array.from(new Set(stats.targetAccountIds.map(String).map(text).filter(Boolean)))
    : [];
}

/**
 * Evaluates the durable authorization binding without doing I/O. The fence
 * comparison may be disabled only by the explicit reconciliation flow, which
 * must establish a new fence with CAS before the post becomes due again.
 */
export function evaluateDigitalEmployeePublishGovernance(
  post: PostRecord,
  run: GovernanceRecord | null,
  approval: GovernanceRecord | null,
  options: { requireRunnableFence?: boolean } = {},
): PublishGovernanceDecision {
  const stats = statsOf(post);
  if (stats.source !== 'digital_employee') return { ok: true };
  const runId = text(post.digital_employee_run_id);
  const approvalId = text(post.digital_employee_approval_id);
  const actionHash = text(post.digital_employee_action_hash);
  if (!runId || !approvalId || !/^[a-f0-9]{64}$/.test(actionHash)) {
    return { ok: false, code: 'publishing_governance_binding_missing', disposition: 'hold' };
  }
  if (text(stats.approvalId) !== approvalId || text(stats.approvedActionHash) !== actionHash) {
    return { ok: false, code: 'publishing_governance_binding_changed', disposition: 'hold' };
  }
  if (!run || run.id !== runId || run.tenant_id !== post.tenant_id) {
    return { ok: false, code: 'publishing_run_context_missing', disposition: 'hold' };
  }
  const runStatus = text(run.status);
  if (!['running', 'succeeded'].includes(runStatus)) {
    return {
      ok: false,
      code: `publishing_run_${runStatus || 'invalid'}`,
      disposition: ['cancelled', 'failed'].includes(runStatus) ? 'cancel' : 'hold',
    };
  }
  if (!approval || approval.id !== approvalId || approval.tenant_id !== post.tenant_id || approval.run_id !== runId) {
    return { ok: false, code: 'publishing_approval_context_missing', disposition: 'hold' };
  }
  if (!['approved', 'approved_with_changes'].includes(text(approval.status))) {
    return { ok: false, code: 'publishing_approval_not_live', disposition: 'hold' };
  }
  if (text(approval.approved_payload_hash) !== actionHash
    || Number(approval.revision || 0) !== Number(stats.approvalRevision || 0)) {
    return { ok: false, code: 'publishing_approval_snapshot_changed', disposition: 'hold' };
  }
  if (options.requireRunnableFence !== false) {
    if (post.reconciliation_required === true) return { ok: false, code: 'publishing_reconciliation_required', disposition: 'reconcile' };
    if (Number(post.digital_employee_fence_revision || 0) !== Number(stats.authorizedFenceRevision || 0)) {
      return { ok: false, code: 'publishing_fence_changed', disposition: 'hold' };
    }
    if (['on_hold', 'cancelled', 'voided', 'needs_reconciliation'].includes(text(stats.status))) {
      return {
        ok: false,
        code: `publishing_post_${text(stats.status) || 'not_runnable'}`,
        disposition: text(stats.status) === 'needs_reconciliation' ? 'reconcile' : 'hold',
      };
    }
  }
  return { ok: true };
}

export function normalizeReconciliationDecision(
  post: PostRecord,
  body: unknown,
): { ok: true; value: ReconciliationDecision } | { ok: false; error: string } {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const action = text(source.action) as ReconciliationDecision['action'];
  if (!['confirm_published', 'confirm_not_published_retry', 'void'].includes(action)) return { ok: false, error: 'reconciliation_action_invalid' };
  if (!Number.isInteger(source.expectedRevision) || Number(source.expectedRevision) < 0) return { ok: false, error: 'expected_revision_required' };
  const note = text(source.note).slice(0, 2_000);
  if (note.length < 3) return { ok: false, error: 'reconciliation_note_required' };
  const targetAccountIds = targetAccountIdsOf(post);
  if (!targetAccountIds.length) return { ok: false, error: 'reconciliation_target_accounts_missing' };
  if (!Array.isArray(source.receipts)) return { ok: false, error: 'account_receipts_required' };
  const receipts: ReconciliationReceipt[] = [];
  const seen = new Set<string>();
  for (const raw of source.receipts) {
    const receipt = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const accountId = text(receipt.accountId).slice(0, 120);
    const outcome = text(receipt.outcome) as ReconciliationReceipt['outcome'];
    const platformPostId = text(receipt.platformPostId).slice(0, 500);
    const verifiedAt = text(receipt.verifiedAt).slice(0, 80);
    const evidence = text(receipt.evidence).slice(0, 2_000);
    if (!targetAccountIds.includes(accountId) || seen.has(accountId)) return { ok: false, error: 'account_receipts_do_not_match_targets' };
    if (!['published', 'not_published'].includes(outcome)) return { ok: false, error: 'account_receipt_outcome_invalid' };
    if (!Number.isFinite(Date.parse(verifiedAt)) || evidence.length < 3) return { ok: false, error: 'account_receipt_evidence_required' };
    if (outcome === 'published' && !platformPostId) return { ok: false, error: 'platform_post_id_required' };
    seen.add(accountId);
    receipts.push({ accountId, outcome, platformPostId, verifiedAt: new Date(Date.parse(verifiedAt)).toISOString(), evidence });
  }
  if (seen.size !== targetAccountIds.length) return { ok: false, error: 'account_receipts_incomplete' };
  if (action === 'confirm_published' && receipts.some(receipt => receipt.outcome !== 'published')) return { ok: false, error: 'published_confirmation_requires_published_receipts' };
  if (action === 'confirm_not_published_retry' && !receipts.some(receipt => receipt.outcome === 'not_published')) {
    return { ok: false, error: 'retry_requires_not_published_receipt' };
  }
  return { ok: true, value: { action, expectedRevision: Number(source.expectedRevision), note, receipts } };
}

function attemptsOf(stats: Record<string, unknown>): number {
  const attempts = Number(stats.publishAttempts || 0);
  return Number.isFinite(attempts) && attempts > 0 ? Math.floor(attempts) : 0;
}

export function scheduledRetryDelay(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(Math.max(attempt - 1, 0), RETRY_DELAYS_MS.length - 1)];
}

export function isScheduledPostDue(post: PostRecord, now = Date.now()): boolean {
  const stats = statsOf(post);
  const status = text(stats.status);
  // Direct-publish tracking rows also use published_at/status but are not
  // schedules. Admission requires the immutable approved schedule marker.
  if (stats.directPublish === true || !['manual', 'digital_employee'].includes(text(stats.source))) return false;
  if (!/^[a-f0-9]{64}$/.test(text(stats.schedulePayloadHash))) return false;
  const leaseExpiresAt = Date.parse(text(post.publish_lease_expires_at));
  if (post.publish_lease_owner && Number.isFinite(leaseExpiresAt) && leaseExpiresAt > now) return false;
  const scheduledAt = Date.parse(text(post.published_at));
  if (!Number.isFinite(scheduledAt) || scheduledAt > now || attemptsOf(stats) >= MAX_ATTEMPTS) return false;
  if (status === 'scheduled') return true;
  if (status === 'failed') {
    const retryAt = Date.parse(text(stats.nextPublishAttemptAt));
    return Number.isFinite(retryAt) && retryAt <= now;
  }
  if (status === 'publishing') {
    const lockedAt = Date.parse(text(stats.lastPublishAttemptAt));
    return Number.isFinite(lockedAt) && lockedAt + STALE_LOCK_MS <= now;
  }
  return false;
}

function resultMap(stats: Record<string, unknown>): Record<string, PublishResult> {
  const value = stats.publishResults;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, PublishResult>) }
    : {};
}

/** Accounts already proven published remain fenced across mixed-account retries. */
export function targetAccountsRequiringPublish(post: PostRecord): string[] {
  const results = resultMap(statsOf(post));
  return targetAccountIdsOf(post).filter(accountId => results[accountId]?.status !== 'published');
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return '平台未返回明确错误，请稍后重试';
}

async function updateScheduledOperationState(
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

async function persistScheduledProviderOperationEvidence(
  post: PostRecord,
  operationId: string,
  accountId: string,
  providerHandle: string,
): Promise<void> {
  const persisted = await persistProviderOperationEvidence({
    store,
    postId: post.id,
    tenantId: post.tenant_id,
    platform: post.platform,
    operationId,
    accountId,
    handle: providerHandle,
    leaseOwner: PUBLISH_WORKER_ID,
    leaseExtensionMs: ACTIVE_PUBLISH_LEASE_MS,
  });
  Object.assign(post, persisted.record);
}

async function withPlatformPublishTimeout<T>(
  post: PostRecord,
  operationId: string,
  operationContext: { providerOperationId?: string },
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  try {
    return await runAbortablePublishOperation(work, {
      timeoutMs: PUBLISH_ACCOUNT_TIMEOUT_MS,
      onTimeout: () => updateScheduledOperationState(post.id, operationId, publishOperationQuiescingPatch(operationId)),
      onSettled: settledAfterTimeout => updateScheduledOperationState(
        post.id,
        operationId,
        publishOperationQuiescedPatch(operationId, { requireCooldown: settledAfterTimeout }),
      ),
    });
  } catch (error) {
    if (operationContext.providerOperationId && error && typeof error === 'object' && Object.isExtensible(error)) {
      Object.assign(error, { providerOperationId: operationContext.providerOperationId });
    }
    throw error;
  }
}

async function updateClaimedPost(post: PostRecord, patch: Record<string, unknown>): Promise<PostRecord> {
  const changed = await compareAndSetRecord<PostRecord>({
    store,
    collection: 'posts',
    id: post.id,
    expected: {
      publish_lease_owner: PUBLISH_WORKER_ID,
      publish_revision: Number(post.publish_revision || 0),
      digital_employee_fence_revision: Number(post.digital_employee_fence_revision || 0),
    },
    patch: withPublishQueueProjection(post, {
      ...patch,
      publish_revision: Number(post.publish_revision || 0) + 1,
    }),
  });
  if (!changed.ok) throw new Error('publish_lease_lost');
  Object.assign(post, changed.record);
  return changed.record;
}

async function liveGovernanceDecision(
  post: PostRecord,
  options: { requireRunnableFence?: boolean } = {},
): Promise<PublishGovernanceDecision> {
  const stats = statsOf(post);
  if (stats.source !== 'digital_employee') return { ok: true };
  const [run, approval] = await Promise.all([
    text(post.digital_employee_run_id) ? store.getById<GovernanceRecord>('workflow_runs', text(post.digital_employee_run_id)) : null,
    text(post.digital_employee_approval_id) ? store.getById<GovernanceRecord>('approval_requests', text(post.digital_employee_approval_id)) : null,
  ]);
  return evaluateDigitalEmployeePublishGovernance(post, run, approval, options);
}

async function stopClaimedPostForGovernance(
  post: PostRecord,
  decision: PublishGovernanceDecision,
  phase: 'before_publishing' | 'before_platform_call',
): Promise<void> {
  const stats = statsOf(post);
  const uncertain = phase === 'before_platform_call' || decision.disposition === 'reconcile';
  const nextStatus = uncertain ? 'needs_reconciliation' : decision.disposition === 'cancel' ? 'cancelled' : 'on_hold';
  const message = decision.code || 'publishing_authorization_not_live';
  await updateClaimedPost(post, {
    stats: {
      ...stats,
      status: nextStatus,
      heldFromStatus: uncertain ? text(stats.heldFromStatus) : text(stats.status) || 'scheduled',
      publishError: message,
      nextPublishAttemptAt: '',
      warnings: [message],
    },
    digital_employee_fence_revision: Number(post.digital_employee_fence_revision || 0) + 1,
    publish_lease_owner: '',
    publish_lease_expires_at: '',
    reconciliation_required: uncertain,
  });
}

async function revalidateBeforePlatformCall(post: PostRecord): Promise<PublishGovernanceDecision> {
  const fresh = await store.getById<PostRecord>('posts', post.id);
  if (!fresh) return { ok: false, code: 'publishing_post_missing', disposition: 'reconcile' };
  if (fresh.publish_lease_owner !== PUBLISH_WORKER_ID
    || Number(fresh.publish_revision || 0) !== Number(post.publish_revision || 0)
    || Number(fresh.digital_employee_fence_revision || 0) !== Number(post.digital_employee_fence_revision || 0)) {
    return { ok: false, code: 'publish_fence_changed', disposition: 'reconcile' };
  }
  return liveGovernanceDecision(fresh);
}

export type RunPostFenceResult = { inspected: number; changed: number; reconciliations: number; conflicts: string[] };

/**
 * Invalidate every executable schedule owned by a run after the run transition
 * has committed. CAS conflicts never reopen execution: the worker's live run
 * gate remains the authoritative fail-closed barrier.
 */
export async function fenceDigitalEmployeePostsForRun(input: {
  tenantId: string;
  runId: string;
  mode: 'pause' | 'cancel';
  reason: string;
}): Promise<RunPostFenceResult> {
  const records = await listAllRecords<PostRecord>({
    store, collection: 'posts',
    query: { where: { tenant_id: input.tenantId, digital_employee_run_id: input.runId }, sort: 'id' },
  });
  const result: RunPostFenceResult = { inspected: records.length, changed: 0, reconciliations: 0, conflicts: [] };
  for (const listed of records) {
    let resolved = false;
    for (let attempt = 0; attempt < 4 && !resolved; attempt += 1) {
      const post = attempt === 0 ? listed : await store.getById<PostRecord>('posts', listed.id);
      if (!post || post.tenant_id !== input.tenantId || text(post.digital_employee_run_id) !== input.runId) { resolved = true; break; }
      const stats = statsOf(post);
      const status = text(stats.status);
      if (['published', 'cancelled', 'voided'].includes(status)
        || (input.mode === 'pause' && ['on_hold', 'needs_reconciliation'].includes(status))
        || (input.mode === 'cancel' && status === 'needs_reconciliation')) {
        resolved = true;
        break;
      }
      const uncertain = ['publishing', 'partial'].includes(status);
      const nextStatus = uncertain ? 'needs_reconciliation' : input.mode === 'cancel' ? 'cancelled' : 'on_hold';
      const nextFence = Number(post.digital_employee_fence_revision || 0) + 1;
      const changed = await compareAndSetRecord<PostRecord>({
        store,
        collection: 'posts',
        id: post.id,
        expected: {
          publish_revision: Number(post.publish_revision || 0),
          digital_employee_fence_revision: Number(post.digital_employee_fence_revision || 0),
          digital_employee_run_id: input.runId,
        },
        patch: withPublishQueueProjection(post, {
          stats: {
            ...stats,
            status: nextStatus,
            heldFromStatus: uncertain ? text(stats.heldFromStatus) : status || 'scheduled',
            publishError: input.reason,
            nextPublishAttemptAt: '',
            warnings: [input.reason],
          },
          digital_employee_fence_revision: nextFence,
          publish_revision: Number(post.publish_revision || 0) + 1,
          publish_lease_owner: '',
          publish_lease_expires_at: '',
          reconciliation_required: uncertain,
        }),
      });
      if (changed.ok) {
        result.changed += 1;
        if (uncertain) result.reconciliations += 1;
        resolved = true;
      }
    }
    if (!resolved) result.conflicts.push(listed.id);
  }
  return result;
}

export async function releaseHeldDigitalEmployeePostsForRun(input: {
  tenantId: string;
  runId: string;
}): Promise<RunPostFenceResult> {
  const records = await listAllRecords<PostRecord>({
    store, collection: 'posts',
    query: { where: { tenant_id: input.tenantId, digital_employee_run_id: input.runId }, sort: 'id' },
  });
  const result: RunPostFenceResult = { inspected: records.length, changed: 0, reconciliations: 0, conflicts: [] };
  for (const listed of records.filter(post => text(statsOf(post).status) === 'on_hold')) {
    let resolved = false;
    for (let attempt = 0; attempt < 4 && !resolved; attempt += 1) {
      const post = attempt === 0 ? listed : await store.getById<PostRecord>('posts', listed.id);
      if (!post || post.tenant_id !== input.tenantId || text(post.digital_employee_run_id) !== input.runId) { resolved = true; break; }
      const stats = statsOf(post);
      if (text(stats.status) !== 'on_hold') { resolved = true; break; }
      const authorization = await liveGovernanceDecision(post, { requireRunnableFence: false });
      if (!authorization.ok) break;
      const nextFence = Number(post.digital_employee_fence_revision || 0) + 1;
      const priorStatus = ['scheduled', 'failed'].includes(text(stats.heldFromStatus)) ? text(stats.heldFromStatus) : 'scheduled';
      const changed = await compareAndSetRecord<PostRecord>({
        store,
        collection: 'posts',
        id: post.id,
        expected: {
          publish_revision: Number(post.publish_revision || 0),
          digital_employee_fence_revision: Number(post.digital_employee_fence_revision || 0),
          digital_employee_run_id: input.runId,
        },
        patch: withPublishQueueProjection(post, {
          stats: {
            ...stats,
            status: priorStatus,
            heldFromStatus: '',
            authorizedFenceRevision: nextFence,
            publishError: '',
            nextPublishAttemptAt: priorStatus === 'failed' ? new Date().toISOString() : text(stats.nextPublishAttemptAt),
            warnings: [],
          },
          digital_employee_fence_revision: nextFence,
          publish_revision: Number(post.publish_revision || 0) + 1,
          reconciliation_required: false,
        }),
      });
      if (changed.ok) { result.changed += 1; resolved = true; }
    }
    if (!resolved) result.conflicts.push(listed.id);
  }
  return result;
}

export async function validateReconciliationRetryAuthorization(post: PostRecord): Promise<PublishGovernanceDecision> {
  return liveGovernanceDecision(post, { requireRunnableFence: false });
}

export function reconciliationPatchForDecision(
  post: PostRecord,
  decision: ReconciliationDecision,
  actorUserId: string,
  now = new Date().toISOString(),
): Record<string, unknown> {
  const stats = statsOf(post);
  const nextFence = Number(post.digital_employee_fence_revision || 0) + 1;
  const previousHistory = Array.isArray(stats.reconciliationHistory) ? stats.reconciliationHistory.slice(-19) : [];
  const historyEntry = {
    action: decision.action,
    note: decision.note,
    receipts: decision.receipts,
    decidedBy: actorUserId,
    decidedAt: now,
    priorPublishRevision: Number(post.publish_revision || 0),
  };
  const publishResults = Object.fromEntries(decision.receipts.map(receipt => [receipt.accountId, receipt.outcome === 'published' ? {
    status: 'published',
    platformPostId: receipt.platformPostId,
    publishedAt: receipt.verifiedAt,
    reconciliationEvidence: receipt.evidence,
  } : {
    status: 'failed',
    error: '人工核对确认平台未发布',
    failedAt: receipt.verifiedAt,
    reconciliationEvidence: receipt.evidence,
  }]));
  const commonStats = {
    ...stats,
    reconciliationHistory: [...previousHistory, historyEntry],
    reconciliationDecision: decision.action,
    reconciliationNote: decision.note,
    reconciliationResolvedBy: actorUserId,
    reconciliationResolvedAt: now,
    heldFromStatus: '',
    warnings: [],
  };
  const commonPatch: Record<string, unknown> = {
    digital_employee_fence_revision: nextFence,
    publish_revision: Number(post.publish_revision || 0) + 1,
    publish_lease_owner: '',
    publish_lease_expires_at: '',
    reconciliation_required: false,
    ...(text(post.publish_operation_id) && text(post.publish_operation_state) === 'quiescing'
      && reconciliationOperationBlock(post, Date.parse(now)) === null
      ? publishOperationQuiescedPatch(text(post.publish_operation_id), { now: Date.parse(now) })
      : {}),
  };
  if (decision.action === 'confirm_published') {
    const firstPostId = decision.receipts.map(receipt => receipt.platformPostId).find(Boolean) || '';
    return withPublishQueueProjection(post, {
      ...commonPatch,
      platform_post_id: firstPostId,
      published_at: now,
      stats: {
        ...commonStats,
        status: 'published',
        publishResults,
        publishedAt: now,
        publishError: '',
        nextPublishAttemptAt: '',
        authorizedFenceRevision: nextFence,
      },
    });
  }
  if (decision.action === 'confirm_not_published_retry') {
    return withPublishQueueProjection(post, {
      ...commonPatch,
      // A top-level platform ID means the whole queue item is terminal. Mixed
      // account evidence belongs in publishResults so the scheduler can retain
      // published-account fences while retrying only confirmed misses.
      platform_post_id: '',
      stats: {
        ...commonStats,
        status: 'failed',
        // Keep account-level published receipts fenced; the scheduler skips
        // them and retries only accounts explicitly confirmed not published.
        publishResults,
        publishAttempts: 0,
        publishError: '',
        nextPublishAttemptAt: now,
        authorizedFenceRevision: nextFence,
      },
    });
  }
  const detectedPublication = decision.receipts.find(receipt => receipt.outcome === 'published');
  return withPublishQueueProjection(post, {
    ...commonPatch,
    ...(detectedPublication ? {
      platform_post_id: detectedPublication.platformPostId,
      published_at: detectedPublication.verifiedAt || now,
    } : {}),
    stats: {
      ...commonStats,
      status: 'voided',
      publishResults,
      externalPublicationsDetected: Boolean(detectedPublication),
      publishError: '',
      nextPublishAttemptAt: '',
      authorizedFenceRevision: nextFence,
    },
  });
}

/** Build the fail-closed state used whenever a remote publish may have landed. */
export function uncertainPublishReconciliationPatch(
  post: PostRecord,
  stats: Record<string, unknown>,
  attempts: number,
  results: Record<string, PublishResult>,
  message: string,
  now = new Date().toISOString(),
): Record<string, unknown> {
  return withPublishQueueProjection(post, {
    stats: {
      ...stats,
      status: 'needs_reconciliation',
      publishResults: results,
      publishAttempts: attempts,
      publishError: message,
      warnings: [message],
      nextPublishAttemptAt: '',
      outcomeUnknown: true,
      reconciliationReason: 'platform_publish_outcome_unknown',
      reconciliationStartedAt: now,
    },
    digital_employee_fence_revision: Number(post.digital_employee_fence_revision || 0) + 1,
    publish_lease_owner: '',
    publish_lease_expires_at: '',
    reconciliation_required: true,
  });
}

export function interruptedPublishResults(
  post: PostRecord,
  stats: Record<string, unknown>,
  message: string,
  now = new Date().toISOString(),
): Record<string, PublishResult> {
  const results = resultMap(stats);
  for (const accountId of targetAccountIdsOf(post)) {
    const evidence = providerOperationEvidenceForAccount(
      post,
      text(post.publish_operation_id),
      accountId,
    );
    if (results[accountId]?.status) {
      if (evidence?.reference && !results[accountId]?.providerOperationId) {
        results[accountId] = { ...results[accountId], providerOperationId: evidence.reference };
      }
      continue;
    }
    results[accountId] = {
      status: 'unknown',
      outcomeUnknown: true,
      error: message,
      failedAt: now,
      failureReason: 'worker_interrupted_during_platform_publish',
      ...(evidence?.reference ? { providerOperationId: evidence.reference } : {}),
    };
  }
  return results;
}

export type StaleDirectPublishReconciliationResult = {
  inspected: number;
  candidates: number;
  reconciled: number;
  conflicts: number;
};

function directPublishHasFinalPlatformId(post: PostRecord, stats: Record<string, unknown>): boolean {
  if (text(post.platform_post_id)) return true;
  return Object.values(resultMap(stats)).some(result => text(result.platformPostId));
}

export function isExpiredDirectPublishAttempt(post: PostRecord, now = Date.now()): boolean {
  const stats = statsOf(post);
  if (stats.directPublish !== true || text(stats.status) !== 'publishing') return false;
  if (post.reconciliation_required === true || directPublishHasFinalPlatformId(post, stats)) return false;
  const leaseExpiresAt = Date.parse(text(post.publish_lease_expires_at));
  const lastAttemptAt = Date.parse(text(stats.lastPublishAttemptAt));
  const deadlines = [
    ...(Number.isFinite(leaseExpiresAt) ? [leaseExpiresAt] : []),
    ...(Number.isFinite(lastAttemptAt) ? [lastAttemptAt + STALE_LOCK_MS] : []),
  ];
  return deadlines.length > 0 && Math.max(...deadlines) <= now;
}

/**
 * A direct provider call cannot be replayed after its process/lease disappears:
 * the remote side may have committed. Move only the exact stale revision into
 * reconciliation and retain the content-fence and provider-operation evidence.
 */
export async function reconcileExpiredDirectPublishAttempts(
  dataStore: DataStore,
  now = Date.now(),
  limit = 100,
): Promise<StaleDirectPublishReconciliationResult> {
  const boundedLimit = boundedQueueBatchLimit(limit, 100);
  const dueAt = new Date(now).toISOString();
  const result = await dataStore.list<PostRecord>('posts', {
    where: { publish_queue_state: 'direct' },
    lte: { publish_available_at: dueAt },
    sort: 'publish_available_at,id',
    page: 1,
    perPage: queueCandidateReadLimit(boundedLimit),
    skipTotal: true,
  });
  const outcome: StaleDirectPublishReconciliationResult = {
    inspected: result.items.length,
    candidates: 0,
    reconciled: 0,
    conflicts: 0,
  };
  for (const post of result.items) {
    if (!isExpiredDirectPublishAttempt(post, now)) continue;
    if (outcome.candidates >= boundedLimit) break;
    outcome.candidates += 1;
    const stats = statsOf(post);
    const timestamp = new Date(now).toISOString();
    const warning = '直接发布进程在取得平台确定结果前中断；为防止重复发布，必须人工对账后再处理。';
    const results = interruptedPublishResults(post, stats, '直接发布 worker 中断', timestamp);
    const directAccountId = text(post.direct_publish_account_id);
    if (directAccountId && !results[directAccountId]?.status) {
      results[directAccountId] = {
        status: 'unknown',
        outcomeUnknown: true,
        error: '直接发布 worker 中断',
        failedAt: timestamp,
        failureReason: 'worker_interrupted_during_platform_publish',
      };
    }
    const operationId = text(post.publish_operation_id);
    const operationState = text(post.publish_operation_state);
    const changed = await compareAndSetRecord<PostRecord>({
      store: dataStore,
      collection: 'posts',
      id: post.id,
      expected: {
        publish_revision: Number(post.publish_revision || 0),
        digital_employee_fence_revision: Number(post.digital_employee_fence_revision || 0),
        publish_lease_owner: text(post.publish_lease_owner),
        publish_lease_expires_at: text(post.publish_lease_expires_at),
        platform_post_id: '',
        reconciliation_required: false,
        publish_operation_id: operationId,
        publish_operation_state: operationState,
        publish_queue_state: text(post.publish_queue_state),
        publish_available_at: text(post.publish_available_at),
      },
      patch: withPublishQueueProjection(post, {
        stats: {
          ...stats,
          status: 'needs_reconciliation',
          publishResults: results,
          publishError: warning,
          warnings: [warning],
          nextPublishAttemptAt: '',
          outcomeUnknown: true,
          reconciliationReason: 'direct_publish_worker_interrupted',
          reconciliationStartedAt: timestamp,
        },
        publish_lease_owner: '',
        publish_lease_expires_at: '',
        publish_revision: Number(post.publish_revision || 0) + 1,
        digital_employee_fence_revision: Number(post.digital_employee_fence_revision || 0) + 1,
        reconciliation_required: true,
        ...(operationId && ['active', 'quiescing'].includes(operationState)
          ? publishOperationQuiescedPatch(operationId, { now, requireCooldown: true })
          : {}),
      }),
    });
    if (changed.ok) outcome.reconciled += 1;
    else outcome.conflicts += 1;
  }
  return outcome;
}

async function markNeedsReconciliation(
  post: PostRecord,
  stats: Record<string, unknown>,
  attempts: number,
  results: Record<string, PublishResult>,
  message: string,
): Promise<void> {
  const patch = uncertainPublishReconciliationPatch(post, stats, attempts, results, message);
  try {
    await updateClaimedPost(post, patch);
  } catch (error) {
    // Preserve the intended terminal state in memory so the cycle-level
    // handler never converts an uncertain outcome back into an auto-retry.
    Object.assign(post, patch);
    throw error;
  }
}

async function markFailed(post: PostRecord, stats: Record<string, unknown>, attempts: number, message: string): Promise<void> {
  const exhausted = attempts >= MAX_ATTEMPTS;
  const results = resultMap(stats);
  const hasSuccess = Object.values(results).some(result => result.status === 'published');
  await updateClaimedPost(post, {
    stats: {
      ...stats,
      status: exhausted ? (hasSuccess ? 'partial' : 'failed') : 'failed',
      publishAttempts: attempts,
      publishError: message,
      warnings: [message],
      nextPublishAttemptAt: exhausted ? '' : new Date(Date.now() + scheduledRetryDelay(attempts)).toISOString(),
    },
    publish_lease_owner: '',
    publish_lease_expires_at: '',
  });
}

async function claimScheduledPost(post: PostRecord, now: number): Promise<'claimed' | 'reconciliation' | 'conflict'> {
  const stats = statsOf(post);
  const stalePublishing = text(stats.status) === 'publishing';
  const leaseExpiresAt = Date.parse(text(post.publish_lease_expires_at));
  if (post.publish_lease_owner && Number.isFinite(leaseExpiresAt) && leaseExpiresAt > now) return 'conflict';
  const expected = {
    publish_lease_owner: post.publish_lease_owner || '',
    publish_lease_expires_at: post.publish_lease_expires_at || '',
    publish_revision: Number(post.publish_revision || 0),
    digital_employee_fence_revision: Number(post.digital_employee_fence_revision || 0),
  };
  if (stalePublishing) {
    const warning = '上次发布进程在平台调用期间中断，结果可能已在平台生效；为防止重复发布，必须人工核对后再处理。';
    const results = interruptedPublishResults(post, stats, '发布进程在取得平台确定结果前中断', new Date(now).toISOString());
    const changed = await compareAndSetRecord<PostRecord>({
      store,
      collection: 'posts',
      id: post.id,
      expected,
      patch: withPublishQueueProjection(post, {
        stats: {
          ...stats,
          status: 'needs_reconciliation',
          publishResults: results,
          publishError: warning,
          warnings: [warning],
          nextPublishAttemptAt: '',
          outcomeUnknown: true,
          reconciliationReason: 'publishing_worker_interrupted',
          reconciliationStartedAt: new Date(now).toISOString(),
        },
        publish_lease_owner: '',
        publish_lease_expires_at: '',
        publish_revision: Number(post.publish_revision || 0) + 1,
        digital_employee_fence_revision: Number(post.digital_employee_fence_revision || 0) + 1,
        reconciliation_required: true,
        ...(post.publish_operation_id
          ? publishOperationQuiescedPatch(post.publish_operation_id, { now, requireCooldown: true })
          : {}),
      }),
    });
    if (!changed.ok) return 'conflict';
    Object.assign(post, changed.record);
    return 'reconciliation';
  }
  const changed = await compareAndSetRecord<PostRecord>({
    store,
    collection: 'posts',
    id: post.id,
    expected,
    patch: withPublishQueueProjection(post, {
      publish_lease_owner: PUBLISH_WORKER_ID,
      publish_lease_expires_at: new Date(now + PUBLISH_LEASE_MS).toISOString(),
      publish_revision: Number(post.publish_revision || 0) + 1,
      reconciliation_required: false,
    }),
  });
  if (!changed.ok) return 'conflict';
  Object.assign(post, changed.record);
  return 'claimed';
}

async function publishScheduledPost(post: PostRecord, now = Date.now()): Promise<boolean | void> {
  const claim = await claimScheduledPost(post, now);
  if (claim === 'conflict') return false;
  if (claim === 'reconciliation') return true;
  const initialStats = statsOf(post);
  const attempts = attemptsOf(initialStats) + 1;
  const initialGovernance = await liveGovernanceDecision(post);
  if (!initialGovernance.ok) {
    await stopClaimedPostForGovernance(post, initialGovernance, 'before_publishing').catch(error => {
      if (errorMessage(error) !== 'publish_lease_lost') throw error;
    });
    return;
  }
  const integrity = verifyApprovedScheduledPost(post);
  if (!integrity.ok) {
    await markFailed(post, initialStats, MAX_ATTEMPTS, integrity.reason || 'approved_schedule_integrity_failed');
    return;
  }
  if (!await scheduledPostContentFencesAttached(store, post)) {
    await markFailed(post, initialStats, MAX_ATTEMPTS, 'scheduled_publish_content_fence_missing');
    return;
  }
  const approvedDigest = text(initialStats.videoSha256).toLowerCase();
  const approvedVideoPath = text(initialStats.videoPath);
  if (!approvedVideoPath) {
    await markFailed(post, initialStats, MAX_ATTEMPTS, 'immutable_local_video_required');
    return;
  }
  if (approvedVideoPath) {
    if (!/^[a-f0-9]{64}$/.test(approvedDigest)) {
      await markFailed(post, initialStats, MAX_ATTEMPTS, 'scheduled_video_digest_missing');
      return;
    }
    const currentDigest = (await tenantPublishingVideoSha256(post.tenant_id, approvedVideoPath)).sha256;
    if (currentDigest !== approvedDigest) {
      await markFailed(post, initialStats, MAX_ATTEMPTS, 'scheduled_video_content_changed');
      return;
    }
  }
  const attemptStartedAt = new Date().toISOString();
  const lockedStats = {
    ...initialStats,
    status: 'publishing',
    publishAttempts: attempts,
    lastPublishAttemptAt: attemptStartedAt,
    nextPublishAttemptAt: '',
    publishError: '',
    warnings: [],
  };
  await updateClaimedPost(post, {
    stats: lockedStats,
    publish_lease_expires_at: new Date(Date.now() + ACTIVE_PUBLISH_LEASE_MS).toISOString(),
  });

  const platform = text(post.platform) as PublishPlatform;
  const accountIds = Array.isArray(initialStats.targetAccountIds)
    ? Array.from(new Set(initialStats.targetAccountIds.map(String).map(text).filter(Boolean)))
    : [];
  const accountLabels = Array.isArray(initialStats.targetAccountLabels)
    ? initialStats.targetAccountLabels.map(String).map(text)
    : [];
  const accountLabel = (accountId: string) => accountLabels[accountIds.indexOf(accountId)] || accountId;
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    await markFailed(post, lockedStats, attempts, `暂不支持自动发布到 ${platform || '未知平台'}`);
    return;
  }
  if (!accountIds.length) {
    await markFailed(post, lockedStats, attempts, '排期任务没有可用的发布账号');
    return;
  }
  const videoPath = text(initialStats.videoPath);
  const videoUrl = text(initialStats.videoUrl);
  if (!videoPath && !videoUrl) {
    await markFailed(post, lockedStats, attempts, '排期任务缺少视频文件');
    return;
  }

  const results = resultMap(initialStats);
  const accountsRequiringPublish = new Set(targetAccountsRequiringPublish(post));
  for (const accountId of accountIds) {
    if (!accountsRequiringPublish.has(accountId)) continue;
    let tiktokPublishOptions: TikTokPublishOptions | undefined;
    if (platform === 'tiktok') {
      const configured = scheduledTikTokPublishOptionsForAccount(post, accountId);
      if (!configured.ok) {
        results[accountId] = {
          status: 'failed',
          error: configured.error,
          failedAt: new Date().toISOString(),
          failureReason: 'local_rejection',
          httpStatus: 422,
        };
        await updateClaimedPost(post, {
          stats: { ...statsOf(post), publishResults: results },
          publish_lease_expires_at: new Date(Date.now() + ACTIVE_PUBLISH_LEASE_MS).toISOString(),
        });
        continue;
      }
      tiktokPublishOptions = configured.value;
    }
    const liveGovernance = await revalidateBeforePlatformCall(post);
    if (!liveGovernance.ok) {
      if (liveGovernance.code !== 'publish_fence_changed' && liveGovernance.code !== 'publishing_post_missing') {
        await stopClaimedPostForGovernance(post, liveGovernance, 'before_platform_call').catch(error => {
          if (errorMessage(error) !== 'publish_lease_lost') throw error;
        });
      }
      return;
    }
    const operationId = newPublishOperationId();
    const operationContext: { providerOperationId?: string } = {};
    try {
      await updateClaimedPost(post, publishOperationStartPatch(operationId));
    } catch (error) {
      if (errorMessage(error) === 'publish_lease_lost') return;
      throw error;
    }
    try {
      const result = await withPlatformPublishTimeout(post, operationId, operationContext, signal => publishVideoToAccount({
          tenantId: post.tenant_id,
          accountId,
          platform,
          videoPath: videoPath || undefined,
          videoUrl: videoUrl || undefined,
          title: text(post.title) || 'Untitled content',
          description: text(initialStats.description),
          privacyStatus: platform === 'tiktok'
            ? tiktokPublishOptions?.privacyLevel === 'PUBLIC_TO_EVERYONE' ? 'public' : 'private'
            : ['private', 'unlisted', 'public'].includes(text(initialStats.privacyStatus))
              ? text(initialStats.privacyStatus) as 'private' | 'unlisted' | 'public'
              : 'public',
          ...(tiktokPublishOptions ? { tiktokPublishOptions } : {}),
          language: text(initialStats.language),
          contentId: text(post.content_id),
          trackWaLink: initialStats.trackWaLink !== false,
          trackingPost: post,
          finalizeTracking: false,
          signal,
          transportTimeoutMs: PUBLISH_ACCOUNT_TIMEOUT_MS,
          onProviderOperationId: async providerOperationId => {
            operationContext.providerOperationId = providerOperationAuditReference(platform, providerOperationId);
            await persistScheduledProviderOperationEvidence(post, operationId, accountId, providerOperationId);
          },
        }));
      if (!text(result.platformPostId)) {
        throw Object.assign(new Error('平台返回成功但缺少可核对的发布内容 ID'), { statusCode: 502 });
      }
      results[accountId] = {
        status: 'published',
        platformPostId: result.platformPostId,
        publishedAt: new Date().toISOString(),
        ...(result.providerOperationId ? {
          providerOperationId: providerOperationAuditReference(platform, result.providerOperationId),
        } : {}),
      };
    } catch (error) {
      const classification = classifyPlatformPublishFailure(error);
      if (classification.outcomeUnknown) {
        const operationTimedOut = Boolean(error && typeof error === 'object'
          && (error as { publishOperationTimedOut?: unknown }).publishOperationTimedOut === true);
        if (!operationTimedOut) {
          await updateScheduledOperationState(
            post.id,
            operationId,
            publishOperationQuiescedPatch(operationId, { requireCooldown: true }),
          );
        }
        const message = `${accountLabel(accountId)}: ${errorMessage(error)}；平台结果不确定，已停止后续账号与自动重试，请人工对账。`;
        results[accountId] = {
          status: 'unknown',
          outcomeUnknown: true,
          error: errorMessage(error),
          failedAt: new Date().toISOString(),
          failureReason: classification.reason,
          ...((error as { providerOperationId?: unknown } | null)?.providerOperationId
            ? {
              providerOperationId: providerOperationAuditReference(
                platform,
                String((error as { providerOperationId: unknown }).providerOperationId),
              ),
            }
            : {}),
          ...(classification.statusCode !== null ? { httpStatus: classification.statusCode } : {}),
        };
        await markNeedsReconciliation(post, statsOf(post), attempts, results, message);
        incrementMetric('scheduled_publisher_outcome_unknown_total');
        structuredLog('warn', 'scheduled_publisher.outcome_unknown', {
          postId: post.id,
          tenantId: post.tenant_id,
          accountId,
          platform,
          reason: classification.reason,
          statusCode: classification.statusCode,
        });
        return;
      }
      results[accountId] = {
        status: 'failed',
        error: errorMessage(error),
        failedAt: new Date().toISOString(),
        failureReason: classification.reason,
        ...((error as { providerOperationId?: unknown } | null)?.providerOperationId
          ? {
            providerOperationId: providerOperationAuditReference(
              platform,
              String((error as { providerOperationId: unknown }).providerOperationId),
            ),
          }
          : {}),
        ...(classification.statusCode !== null ? { httpStatus: classification.statusCode } : {}),
      };
    }
    try {
      await updateClaimedPost(post, {
        stats: { ...statsOf(post), publishResults: results },
        publish_lease_expires_at: new Date(Date.now() + ACTIVE_PUBLISH_LEASE_MS).toISOString(),
      });
    } catch (error) {
      if (results[accountId]?.status === 'published') {
        const message = `${accountLabel(accountId)}: 平台已返回发布成功，但本地结果未能可靠持久化；已停止自动重试，请人工对账。`;
        await markNeedsReconciliation(post, statsOf(post), attempts, results, message);
        return;
      }
      throw error;
    }
  }

  const failures = accountIds.filter(accountId => results[accountId]?.status !== 'published');
  if (failures.length) {
    const message = failures
      .map(accountId => `${accountLabel(accountId)}: ${results[accountId]?.error || '发布失败'}`)
      .join('；');
    await markFailed(post, { ...statsOf(post), publishResults: results }, attempts, message);
    return;
  }

  const firstPlatformPostId = accountIds.map(accountId => text(results[accountId]?.platformPostId)).find(Boolean) || '';
  try {
    await updateClaimedPost(post, {
      platform_post_id: firstPlatformPostId,
      title: text(post.title),
      published_at: new Date().toISOString(),
      stats: {
        ...statsOf(post),
        status: 'published',
        publishResults: results,
        publishedAt: new Date().toISOString(),
        publishError: '',
        nextPublishAttemptAt: '',
        warnings: [],
      },
      publish_lease_owner: '',
      publish_lease_expires_at: '',
      reconciliation_required: false,
    });
  } catch (error) {
    const message = '平台账号均已返回发布成功，但最终状态未能可靠持久化；已停止自动重试，请人工对账。';
    await markNeedsReconciliation(post, statsOf(post), attempts, results, message);
  }
}

let cycleRunning = false;

export async function collectDueScheduledPosts(
  dataStore: DataStore,
  now: number,
  limit = 20,
): Promise<{ posts: PostRecord[]; inspected: number; total: number }> {
  const boundedLimit = boundedQueueBatchLimit(limit, 20);
  const perPage = 500;
  const posts: PostRecord[] = [];
  let inspected = 0;
  let page = 1;
  // Projection drift must not let 500 early false positives starve valid work
  // forever. Scan stable indexed pages until the execution batch is full while
  // retaining a hard per-cycle record bound and skipTotal on every query.
  while (posts.length < boundedLimit && inspected < QUEUE_SCAN_MAX_RECORDS) {
    const result = await dataStore.list<PostRecord>('posts', {
      where: { publish_queue_state: 'pending' },
      lte: { publish_available_at: new Date(now).toISOString() },
      sort: 'publish_available_at,id',
      page,
      perPage,
      skipTotal: true,
    });
    inspected += result.items.length;
    for (const post of result.items) {
      // The indexed projection narrows the read; nested durable state remains
      // authoritative and is checked again before any claim/provider call.
      if (isScheduledPostDue(post, now)) posts.push(post);
      if (posts.length >= boundedLimit) break;
    }
    if (result.items.length < perPage) break;
    page += 1;
  }
  return { posts, inspected, total: -1 };
}

export async function runScheduledPublishingCycle(now = Date.now()): Promise<number> {
  if (cycleRunning) return 0;
  cycleRunning = true;
  try {
    const directReconciliation = await reconcileExpiredDirectPublishAttempts(store, now);
    setGauge('scheduled_publisher_stale_direct_publish_reconciled', directReconciliation.reconciled);
    if (directReconciliation.reconciled || directReconciliation.conflicts) {
      structuredLog('info', 'scheduled_publisher.direct_publish_reconciled', directReconciliation);
    }
    const reservationReconciliation = await reconcileStalePublishContentReservations(store, now);
    setGauge('scheduled_publisher_stale_reservations_released', reservationReconciliation.released);
    if (reservationReconciliation.released || reservationReconciliation.conflicts) {
      structuredLog('info', 'scheduled_publisher.content_reservations_reconciled', reservationReconciliation);
    }
    // Read beyond one execution batch. CAS losers and rows reconciled by another
    // worker do not consume capacity or starve later due schedules.
    const scan = await collectDueScheduledPosts(store, now, 100);
    const duePosts = scan.posts;
    setGauge('scheduled_publisher_due_posts', duePosts.length);
    setGauge('scheduled_publisher_posts_inspected', scan.inspected);
    let processed = 0;
    for (const post of duePosts) {
      if (processed >= 20) break;
      try {
        const handled = await publishScheduledPost(post, now);
        if (handled === false) continue;
        processed += 1;
      } catch (error) {
        processed += 1;
        if (post.publish_lease_owner === PUBLISH_WORKER_ID) {
          const stats = statsOf(post);
          const attempts = Math.max(attemptsOf(stats), 1);
          if (text(stats.status) === 'publishing') {
            const message = `发布执行在取得或持久化平台确定结果时异常：${errorMessage(error)}；已停止自动重试，请人工对账。`;
            const results = interruptedPublishResults(post, stats, message);
            await markNeedsReconciliation(post, stats, attempts, results, message).catch(() => undefined);
          } else if (text(stats.status) !== 'needs_reconciliation') {
            await markFailed(post, stats, attempts, errorMessage(error)).catch(() => undefined);
          }
        }
        console.error(`[publishing-worker] post ${post.id} failed:`, error);
        incrementMetric('scheduled_publisher_post_failures_total');
      }
    }
    return processed;
  } finally {
    cycleRunning = false;
  }
}

export type ScheduledPublisherHandle = { stop: () => Promise<void> };
let activePublisher: ScheduledPublisherHandle | null = null;

export async function withScheduledPublisherCycleHeartbeat<T>(
  work: () => Promise<T>,
  options: {
    intervalMs?: number;
    record?: (name: string, details?: Record<string, unknown>) => void;
    now?: () => number;
  } = {},
): Promise<T> {
  const intervalMs = Math.max(1, Math.floor(options.intervalMs ?? POLL_INTERVAL_MS));
  const record = options.record ?? recordWorkerHeartbeat;
  const now = options.now ?? Date.now;
  const cycleStartedAt = new Date(now()).toISOString();
  const beat = () => record(PUBLISH_WORKER_NAME, {
    state: 'running',
    phase: 'cycle',
    cycleStartedAt,
  });
  beat();
  const timer = setInterval(beat, intervalMs);
  timer.unref?.();
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}

export function initScheduledPublisher(): ScheduledPublisherHandle {
  if (activePublisher) return activePublisher;
  if (process.env.PUBLISH_SCHEDULER_ENABLED === 'false') {
    console.log('[publishing-worker] disabled');
    return { stop: async () => undefined };
  }
  let stopping = false;
  let cycleBusy = false;
  let running: Promise<unknown> = Promise.resolve();
  const unregisterHeartbeat = registerWorkerHeartbeat(PUBLISH_WORKER_NAME, { staleAfterMs: Math.max(120_000, POLL_INTERVAL_MS * 4), critical: true });
  const unregisterReconciliationHealth = registerHealthCheck('scheduled-publisher-reconciliation', async () => {
    const records = await store.list<PostRecord>('posts', { where: { reconciliation_required: true }, perPage: 1 });
    setGauge('scheduled_publisher_reconciliation_required', records.totalItems);
    return records.totalItems
      ? { ok: false, message: 'scheduled_posts_require_reconciliation', details: { count: records.totalItems } }
      : { ok: true, details: { count: 0 } };
  }, { critical: false, timeoutMs: 5_000 });
  const run = () => {
    if (stopping || cycleBusy) return;
    cycleBusy = true;
    running = withScheduledPublisherCycleHeartbeat(() => runScheduledPublishingCycle())
      .then(processed => recordWorkerHeartbeat(PUBLISH_WORKER_NAME, { processed }))
      .catch(error => {
        incrementMetric('scheduled_publisher_cycle_failures_total');
        structuredLog('error', 'scheduled_publisher.cycle_failed', { error: errorMessage(error) });
        recordWorkerHeartbeat(PUBLISH_WORKER_NAME, { error: errorMessage(error) });
      })
      .finally(() => { cycleBusy = false; });
  };
  recordWorkerHeartbeat(PUBLISH_WORKER_NAME, { state: 'starting' });
  // Start the first durable scan immediately. The in-cycle heartbeat refreshes
  // readiness while a provider upload legitimately runs longer than 120s.
  run();
  const timer = setInterval(run, POLL_INTERVAL_MS);
  timer.unref?.();
  activePublisher = {
    stop: async () => {
      if (stopping) return;
      stopping = true;
      clearInterval(timer);
      await running;
      markWorkerStopped(PUBLISH_WORKER_NAME, { state: 'stopped' });
      unregisterReconciliationHealth();
      unregisterHeartbeat();
      activePublisher = null;
    },
  };
  console.log(`[publishing-worker] enabled; polling every ${POLL_INTERVAL_MS / 1000}s`);
  return activePublisher;
}
