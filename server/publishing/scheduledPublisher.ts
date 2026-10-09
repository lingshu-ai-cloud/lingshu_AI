import { isManagedSocialPublication, assertManagedSocialPublication, withManagedSocialPublication } from './managedSocialEffect.js';
import { assertManagedPublishingAuthorization, ManagedPublishingAuthorizationError } from './managedPublishingAuthorization.js';
import { randomUUID } from 'node:crypto';
import type { PublishPlatform } from '../lib/publishHistory.js';
import { store } from '../storage/index.js';
import { publishVideoToAccount, resolvePendingPublishToAccount, type PublishToAccountInput } from './platformPublisher.js';
import { finalizeTrackedPost, type PostRecord } from './waLink.js';
import { digitalEmployeeRunBlockedReason, withDigitalEmployeeExternalAction, WorkflowRunBlockedError } from '../digitalEmployees/runControl.js';
import {
  assertLegacyExternalEffectAllowed,
  Starter198LegacyEffectError,
  withLegacyExternalEffectAllowed,
} from '../starter198/legacyEffectGuard.js';
import {
  acquireDurableOperationLease,
  assertDurableOperationLease,
  releaseDurableOperationLease,
  renewDurableOperationLease,
  type DurableOperationLease,
} from '../runtime/durableLease.js';
import { externalEffectLeaseStore } from '../runtime/externalEffectLeaseStore.js';
import {
  PublishSourceVerificationError,
  verifyFrozenPublishSourceClaim,
  type FrozenPublishSourceClaim,
} from './publishSourceClaim.js';
import { boundedAuthorizationIssue, type BoundedPublishingAuthorizationSnapshot } from '../digitalEmployees/publishingExecution.js';
import { externalVideoApprovalValid, externalVideoSha256 } from './externalVideoApproval.js';

type LegacyEffectExecutor = <T>(tenantId: string, effect: () => Promise<T>) => Promise<T>;
export interface ScheduledPublishLeaseGuard {
  beforeEffect(now?: Date): Promise<void>;
  release(): Promise<void>;
}
type ScheduledPublishLeaseAcquirer = (post: PostRecord, now: Date) => Promise<ScheduledPublishLeaseGuard | null>;

interface ScheduledPublishingDependencies {
  publish: typeof publishVideoToAccount;
  resolvePending?: typeof resolvePendingPublishToAccount;
  finalize: typeof finalizeTrackedPost;
  assertLegacyAccess?: (tenantId: string) => Promise<void>;
  executeLegacyEffect?: LegacyEffectExecutor;
  acquirePublishLease?: ScheduledPublishLeaseAcquirer;
  verifySource?: (tenantId: string, claim: unknown, videoPath?: unknown) => Promise<unknown>;
}
const defaultDependencies: ScheduledPublishingDependencies = {
  publish: publishVideoToAccount,
  resolvePending: resolvePendingPublishToAccount,
  finalize: finalizeTrackedPost,
  assertLegacyAccess: assertLegacyExternalEffectAllowed,
  executeLegacyEffect: withLegacyExternalEffectAllowed,
  verifySource: verifyFrozenPublishSourceClaim,
};

const POLL_INTERVAL_MS = 30_000;
const STALE_LOCK_MS = 15 * 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;
const SUPPORTED_PLATFORMS = new Set<PublishPlatform>(['youtube', 'tiktok', 'instagram', 'facebook']);
const SCHEDULED_PUBLISH_LEASE_SCOPE = 'legacy-scheduled-publish';

type PublishResult = {
  status: 'published' | 'failed' | 'in_flight' | 'provider_accepted' | 'unknown';
  attemptId?: string;
  startedAt?: string;
  platformPostId?: string;
  platformUrl?: string;
  providerReceiptId?: string;
  providerStatus?: string;
  lastCheckedAt?: string;
  publishedAt?: string;
  error?: string;
  failedAt?: string;
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

function attemptsOf(stats: Record<string, unknown>): number {
  const attempts = Number(stats.publishAttempts || 0);
  return Number.isFinite(attempts) && attempts > 0 ? Math.floor(attempts) : 0;
}

export function scheduledRetryDelay(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(Math.max(attempt - 1, 0), RETRY_DELAYS_MS.length - 1)];
}

export function isScheduledPostDue(post: PostRecord, now = Date.now()): boolean {
  const stats = statsOf(post);
  if (!externalVideoApprovalValid(post)) return false;
  const status = text(stats.status);
  const continuingExistingDelivery = ['provider_processing', 'finalize_pending'].includes(status);
  // Digital-employee calendar entries require an explicit, version-frozen
  // tenant authorization in addition to the human content approval. Once a
  // provider receipt exists, status recovery/local finalization is read-only
  // with respect to external delivery and must remain recoverable.
  if (text(stats.workflowRunId) && !continuingExistingDelivery && stats.realPublishingAuthorized !== true) return false;
  if (text(stats.workflowRunId) && !continuingExistingDelivery && text(stats.authorizationMode) === 'bounded') {
    const accounts = Array.isArray(stats.targetAccountIds) ? stats.targetAccountIds.map(String).filter(Boolean) : [];
    const snapshot = stats.boundedAuthorization as BoundedPublishingAuthorizationSnapshot | undefined;
    if (!accounts.length || accounts.some(accountId => boundedAuthorizationIssue(snapshot, {
      accountId,
      platform: text(post.platform) as PublishPlatform,
      scheduledAt: text(post.published_at),
    }))) return false;
  }
  const scheduledAt = Date.parse(text(post.published_at));
  if (!Number.isFinite(scheduledAt) || scheduledAt > now) return false;
  if (Object.values(resultMap(stats)).some(result => result.status === 'unknown')) return false;
  if (status === 'finalize_pending') {
    const retryAt = Date.parse(text(stats.nextPublishAttemptAt));
    return !Number.isFinite(retryAt) || retryAt <= now;
  }
  if (status === 'provider_processing') {
    const retryAt = Date.parse(text(stats.nextProviderCheckAt));
    return !Number.isFinite(retryAt) || retryAt <= now;
  }
  if (attemptsOf(stats) >= MAX_ATTEMPTS) return false;
  if (status === 'scheduled') return true;
  if (status === 'failed') {
    const retryAt = Date.parse(text(stats.nextPublishAttemptAt));
    return !Number.isFinite(retryAt) || retryAt <= now;
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

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return '平台未返回明确错误，请稍后重试';
}

function publishLeaseDurationMs(): number {
  const configured = Number(process.env.PUBLISH_SCHEDULER_LEASE_MS || 30 * 60_000);
  return Number.isFinite(configured)
    ? Math.min(Math.max(Math.floor(configured), 60_000), 2 * 60 * 60_000)
    : 30 * 60_000;
}

async function acquireScheduledPublishLease(post: PostRecord, now: Date): Promise<ScheduledPublishLeaseGuard | null> {
  const leaseDurationMs = publishLeaseDurationMs();
  let lease: DurableOperationLease | null = await acquireDurableOperationLease({
    dataStore: externalEffectLeaseStore,
    tenantId: text(post.tenant_id),
    scope: SCHEDULED_PUBLISH_LEASE_SCOPE,
    subjectId: text(post.id),
    ownerId: `publisher:${process.pid}:${randomUUID()}`,
    now,
    leaseDurationMs,
    reclaimGraceMs: 30_000,
  });
  if (!lease) return null;
  return {
    async beforeEffect(effectNow = new Date()) {
      lease = await renewDurableOperationLease({
        dataStore: externalEffectLeaseStore,
        lease: lease!,
        now: effectNow,
        leaseDurationMs,
      });
      await assertDurableOperationLease({
        dataStore: externalEffectLeaseStore,
        lease,
        now: effectNow,
        minimumRemainingMs: 30_000,
      });
    },
    async release() {
      if (lease) await releaseDurableOperationLease({ dataStore: externalEffectLeaseStore, lease });
    },
  };
}

async function markFailed(post: PostRecord, stats: Record<string, unknown>, attempts: number, message: string): Promise<void> {
  const exhausted = attempts >= MAX_ATTEMPTS;
  const results = resultMap(stats);
  const hasSuccess = Object.values(results).some(result => result.status === 'published');
  const unknown = Object.values(results).some(result => ['unknown', 'in_flight'].includes(result.status));
  const providerProcessing = Object.values(results).some(result => result.status === 'provider_accepted');
  if (unknown) for (const result of Object.values(results)) { if (result.status === 'in_flight') result.status = 'unknown'; }
  await store.update('posts', post.id, {
    stats: {
      ...stats,
      status: unknown ? 'needs_attention' : providerProcessing ? 'provider_processing' : exhausted ? (hasSuccess ? 'partial' : 'failed') : 'failed',
      publishResults: results,
      publishAttempts: attempts,
      publishError: message,
      warnings: [message],
      nextPublishAttemptAt: providerProcessing || exhausted ? '' : new Date(Date.now() + scheduledRetryDelay(attempts)).toISOString(),
      nextProviderCheckAt: providerProcessing ? new Date(Date.now() + POLL_INTERVAL_MS).toISOString() : '',
    },
  });
}

async function publishScheduledPost(
  queuedPost: PostRecord,
  dependencies: ScheduledPublishingDependencies,
  cycleNow: number,
): Promise<void> {
  const acquireLease = dependencies.acquirePublishLease ?? acquireScheduledPublishLease;
  const lease = await acquireLease(queuedPost, new Date(cycleNow));
  if (!lease) return;
  try {
  const post = await store.getById<PostRecord>('posts', queuedPost.id);
  if (!post || text(post.tenant_id) !== text(queuedPost.tenant_id) || !isScheduledPostDue(post, cycleNow)) return;
  const initialStats = statsOf(post);
  const recoveringAcceptedReceipt = Object.values(resultMap(initialStats))
    .some(result => result.status === 'provider_accepted');
  const localFinalizationOnly = text(initialStats.status) === 'finalize_pending';
  if (text(initialStats.status) === 'provider_processing' && !recoveringAcceptedReceipt) {
    await store.update('posts', post.id, { stats: {
      ...initialStats,
      status: 'needs_attention',
      publishError: '平台处理中记录缺少可恢复回执，禁止自动重发',
      nextProviderCheckAt: '',
      warnings: ['平台处理中记录缺少可恢复回执，禁止自动重发'],
    } });
    return;
  }
  if (!recoveringAcceptedReceipt && !localFinalizationOnly) {
    if (isManagedSocialPublication(post)) {
      const ids = Array.isArray(initialStats.targetAccountIds) ? initialStats.targetAccountIds : [];
      if (!ids.length) throw new ManagedPublishingAuthorizationError('社媒发布没有明确目标账号');
      for (const id of ids) await assertManagedSocialPublication(post, String(id));
    } else await (dependencies.assertLegacyAccess ?? assertLegacyExternalEffectAllowed)(post.tenant_id);
  }
  const workflowRunId = text(initialStats.workflowRunId);
  if (workflowRunId && !recoveringAcceptedReceipt && !localFinalizationOnly
    && await digitalEmployeeRunBlockedReason(post.tenant_id, workflowRunId)) return;
  const continuingReceipt = ['finalize_pending', 'provider_processing'].includes(text(initialStats.status));
  const attempts = attemptsOf(initialStats) + (continuingReceipt ? 0 : 1);
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
  if (!await store.update('posts', post.id, { stats: lockedStats })) throw new Error('无法保存发布执行状态，尚未调用平台');

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
  const sourceClaim = initialStats.publishSourceClaim as FrozenPublishSourceClaim | undefined;
  for (const accountId of accountIds) {
    if (results[accountId]?.status === 'published') continue;
    if (results[accountId]?.status === 'provider_accepted') {
      const accepted = results[accountId];
      const providerReceiptId = text(accepted.providerReceiptId);
      if (!providerReceiptId) {
        results[accountId] = {
          ...accepted,
          status: 'unknown',
          error: '平台处理中记录缺少 provider receipt，禁止自动重发',
          failedAt: new Date().toISOString(),
        };
      } else {
        try {
          const resolution = await (dependencies.resolvePending ?? resolvePendingPublishToAccount)({
            tenantId: post.tenant_id,
            accountId,
            platform,
            providerReceiptId,
          });
          if (resolution.providerReceiptId !== providerReceiptId) {
            throw new Error('平台状态回执与原发送回执不一致');
          }
          const checkedAt = new Date().toISOString();
          if (resolution.status === 'published' && text(resolution.platformPostId)) {
            results[accountId] = {
              ...accepted,
              status: 'published',
              providerStatus: resolution.providerStatus,
              platformPostId: resolution.platformPostId,
              platformUrl: resolution.platformUrl,
              publishedAt: checkedAt,
              lastCheckedAt: checkedAt,
              error: '',
            };
          } else if (resolution.status === 'processing') {
            results[accountId] = {
              ...accepted,
              status: 'provider_accepted',
              providerStatus: resolution.providerStatus,
              lastCheckedAt: checkedAt,
              error: '',
            };
          } else {
            results[accountId] = {
              ...accepted,
              status: 'unknown',
              providerStatus: resolution.providerStatus,
              lastCheckedAt: checkedAt,
              error: resolution.error || (resolution.status === 'failed'
                ? 'TikTok 报告发布失败，需人工确认后再决定是否重发'
                : 'TikTok 返回未知发布状态，禁止自动重发'),
              failedAt: checkedAt,
            };
          }
        } catch (error) {
          results[accountId] = {
            ...accepted,
            status: 'unknown',
            error: errorMessage(error),
            failedAt: new Date().toISOString(),
          };
        }
      }
      if (!await store.update('posts', post.id, { stats: { ...lockedStats, publishResults: { ...results } } })) {
        throw new Error('平台状态回执保存失败');
      }
      if (results[accountId].status === 'unknown') {
        await store.update('posts', post.id, { stats: {
          ...lockedStats,
          publishResults: results,
          status: 'needs_attention',
          publishError: results[accountId].error || '平台结果不明，需核对回执，禁止自动重发',
          nextProviderCheckAt: '',
        } });
        return;
      }
      continue;
    }
    if (results[accountId]?.status === 'in_flight' || results[accountId]?.status === 'unknown'
      || (text(initialStats.status) === 'publishing' && !results[accountId])) {
      results[accountId] = { ...results[accountId], status: 'unknown', error: '平台发布结果不明，需核对回执，禁止自动重发' };
      await store.update('posts', post.id, { stats: { ...lockedStats, status: 'needs_attention', publishResults: results, publishError: results[accountId].error } });
      return;
    }
    const attemptId = randomUUID();
    results[accountId] = { status: 'in_flight', attemptId, startedAt: attemptStartedAt };
    if (!await store.update('posts', post.id, { stats: { ...lockedStats, publishResults: { ...results } } })) throw new Error('无法保存平台发送尝试，尚未调用平台');
    try {
      await lease.beforeEffect();
      await assertManagedPublishingAuthorization(post, accountId);
      await (dependencies.verifySource ?? verifyFrozenPublishSourceClaim)(post.tenant_id, sourceClaim, videoPath);
      if (initialStats.origin === 'authorized_external_video') {
        const latest = await store.getById<PostRecord>('posts', post.id);
        if (!latest || !externalVideoApprovalValid(latest)
          || latest.title !== post.title || latest.published_at !== post.published_at
          || statsOf(latest).externalApprovedContentHash !== initialStats.externalApprovedContentHash
          || await externalVideoSha256(videoPath) !== initialStats.videoSha256) {
          throw new PublishSourceVerificationError('external_video_approval_stale', 409, '获授权外部视频已变化，需要重新审批。');
        }
      }
      const publish = () => dependencies.publish({
        tenantId: post.tenant_id,
        accountId,
        platform,
        videoPath: videoPath || undefined,
        videoUrl: videoUrl || undefined,
        title: text(post.title) || 'Untitled content',
        description: text(initialStats.description),
        privacyStatus: 'public',
        language: text(initialStats.language),
        contentId: text(post.content_id),
        trackWaLink: initialStats.trackWaLink !== false,
        trackingPost: post,
        finalizeTracking: false,
        publishAttemptId: attemptId,
        sourceClaim,
        enterpriseFactVersion: text(initialStats.enterpriseFactVersion),
        copyAudit: initialStats.copyAudit as PublishToAccountInput['copyAudit'],
      });
      const guardedPublish = () => isManagedSocialPublication(post)
        ? withManagedSocialPublication(post, accountId, publish)
        : (dependencies.executeLegacyEffect ?? withLegacyExternalEffectAllowed)(post.tenant_id, publish);
      const result = workflowRunId
        ? await withDigitalEmployeeExternalAction(post.tenant_id, workflowRunId, guardedPublish)
        : await guardedPublish();
      if (result.deliveryStatus === 'provider_accepted' && text(result.providerReceiptId)) {
        results[accountId] = {
          status: 'provider_accepted',
          attemptId,
          startedAt: attemptStartedAt,
          providerReceiptId: result.providerReceiptId,
          lastCheckedAt: '',
        };
      } else {
        if (!text(result.platformPostId)) throw new Error('平台未返回最终发布内容 id');
        results[accountId] = {
          status: 'published', attemptId, startedAt: attemptStartedAt,
          platformPostId: result.platformPostId,
          platformUrl: result.platformUrl,
          publishedAt: new Date().toISOString(),
        };
      }
    } catch (error) {
      if (error instanceof PublishSourceVerificationError || error instanceof ManagedPublishingAuthorizationError) {
        delete results[accountId];
        await store.update('posts', post.id, { stats: {
          ...lockedStats,
          status: 'awaiting_reapproval',
          publishResults: results,
          approvedContentHash: '',
          realPublishingAuthorized: false,
          publishError: error.message,
          warnings: [error.message],
        } });
        return;
      }
      if (error instanceof WorkflowRunBlockedError) {
        delete results[accountId];
        await store.update('posts', post.id, { stats: {
          ...lockedStats, status: 'scheduled', publishAttempts: attempts - 1,
          publishResults: results, workflowBlockedReason: error.reason,
        } });
        return;
      }
      if (error instanceof Starter198LegacyEffectError) {
        delete results[accountId];
        await store.update('posts', post.id, { stats: {
          ...lockedStats,
          status: 'scheduled',
          publishAttempts: attempts - 1,
          publishResults: results,
          workflowBlockedReason: error.code,
        } });
        return;
      }
      results[accountId] = {
        status: 'unknown', attemptId, startedAt: attemptStartedAt,
        error: errorMessage(error),
        failedAt: new Date().toISOString(),
      };
    }
    if (!await store.update('posts', post.id, { stats: { ...lockedStats, publishResults: { ...results } } })) throw new Error('平台回执保存失败');
    if (results[accountId].status === 'unknown') {
      await store.update('posts', post.id, { stats: { ...lockedStats, publishResults: results, status: 'needs_attention', publishError: '平台结果不明，需核对回执，禁止自动重发' } });
      return;
    }
  }

  const providerAccepted = accountIds.filter(accountId => results[accountId]?.status === 'provider_accepted');
  if (providerAccepted.length) {
    if (!await store.update('posts', post.id, { stats: {
      ...lockedStats,
      status: 'provider_processing',
      publishResults: results,
      publishError: '',
      nextProviderCheckAt: new Date(cycleNow + POLL_INTERVAL_MS).toISOString(),
      warnings: ['平台已接收上传，正在等待最终公开视频回执。'],
    } })) throw new Error('平台处理中回执保存失败');
    return;
  }

  const failures = accountIds.filter(accountId => results[accountId]?.status !== 'published');
  if (failures.length) {
    const message = failures
      .map(accountId => `${accountLabel(accountId)}: ${results[accountId]?.error || '发布失败'}`)
      .join('；');
    await markFailed(post, { ...lockedStats, publishResults: results }, attempts, message);
    return;
  }

  const firstPlatformPostId = accountIds.map(accountId => text(results[accountId]?.platformPostId)).find(Boolean) || '';
  try {
    await dependencies.finalize(post.id, {
      platformPostId: firstPlatformPostId,
      title: text(post.title),
      stats: {
        ...lockedStats,
        status: 'published',
        publishResults: results,
        publishedAt: new Date().toISOString(),
        publishError: '',
        nextPublishAttemptAt: '',
        nextProviderCheckAt: '',
        warnings: [],
      },
    });
    const finalized = await store.getById<PostRecord>('posts', post.id);
    if (!finalized || text(statsOf(finalized).status) !== 'published') throw new Error('发布已完成，但本地最终回写未成功');
  } catch (error) {
    // All external receipts already exist. Retry local finalization only, even
    // if delivery exhausted its retry budget; never overwrite them with the
    // stale queue snapshot in the outer catch.
    await store.update('posts', post.id, { stats: {
      ...lockedStats, status: 'finalize_pending', publishResults: results,
      publishError: errorMessage(error),
      nextPublishAttemptAt: new Date(Date.now() + scheduledRetryDelay(1)).toISOString(),
    } });
  }
  } finally {
    await lease.release().catch(error => {
      console.error('[publishing-worker] failed to release durable post lease:', error instanceof Error ? error.message : error);
    });
  }
}

let cycleRunning = false;

export async function runScheduledPublishingCycle(now = Date.now(), dependencies: ScheduledPublishingDependencies = defaultDependencies): Promise<number> {
  if (cycleRunning) return 0;
  cycleRunning = true;
  try {
    const duePosts: PostRecord[] = [];
    for (let page = 1; duePosts.length < 20; page += 1) {
      const result = await store.list<PostRecord>('posts', { page, perPage: 500, sort: 'published_at' });
      for (const post of result.items) {
      if (!isScheduledPostDue(post, now)) continue;
      const postStats = statsOf(post);
      const runId = text(postStats.workflowRunId);
      const continuingExistingDelivery = ['provider_processing', 'finalize_pending'].includes(text(postStats.status));
      if (runId && !continuingExistingDelivery
        && await digitalEmployeeRunBlockedReason(post.tenant_id, runId)) continue;
        duePosts.push(post);
        if (duePosts.length >= 20) break;
      }
      if (page >= result.totalPages || !result.items.length) break;
    }
    for (const post of duePosts) {
      try {
        await publishScheduledPost(post, dependencies, now);
      } catch (error) {
        if (error instanceof Starter198LegacyEffectError) continue;
        const latest = await store.getById<PostRecord>('posts', post.id).catch(() => null);
        // If the latest state cannot be read, leave it for recovery instead of
        // overwriting potentially persisted provider receipts.
        if (latest) {
          const stats = statsOf(latest);
          const attempts = Math.max(attemptsOf(stats), 1);
          await markFailed(latest, stats, attempts, errorMessage(error)).catch(() => undefined);
        }
        console.error(`[publishing-worker] post ${post.id} failed:`, error);
      }
    }
    return duePosts.length;
  } finally {
    cycleRunning = false;
  }
}

export function initScheduledPublisher(): void {
  if (!scheduledPublisherEnabled()) {
    console.log('[publishing-worker] disabled; set PUBLISH_SCHEDULER_ENABLED=true on a worker after lease migration verification');
    return;
  }
  const run = () => void runScheduledPublishingCycle().catch(error => {
    console.error('[publishing-worker] cycle failed:', error);
  });
  const initial = setTimeout(run, 5_000);
  initial.unref?.();
  const timer = setInterval(run, POLL_INTERVAL_MS);
  timer.unref?.();
  console.log(`[publishing-worker] enabled; polling every ${POLL_INTERVAL_MS / 1000}s`);
}

export function scheduledPublisherEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.PUBLISH_SCHEDULER_ENABLED === 'true';
}
