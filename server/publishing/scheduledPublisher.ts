import { randomUUID } from 'node:crypto';
import type { PublishPlatform } from '../lib/publishHistory.js';
import { store } from '../storage/index.js';
import { publishVideoToAccount } from './platformPublisher.js';
import { finalizeTrackedPost, type PostRecord } from './waLink.js';
import { digitalEmployeeRunBlockedReason, withDigitalEmployeeExternalAction, WorkflowRunBlockedError } from '../digitalEmployees/runControl.js';

interface ScheduledPublishingDependencies {
  publish: typeof publishVideoToAccount;
  finalize: typeof finalizeTrackedPost;
}
const defaultDependencies: ScheduledPublishingDependencies = { publish: publishVideoToAccount, finalize: finalizeTrackedPost };

const POLL_INTERVAL_MS = 30_000;
const STALE_LOCK_MS = 15 * 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;
const SUPPORTED_PLATFORMS = new Set<PublishPlatform>(['youtube', 'tiktok', 'instagram', 'facebook']);

type PublishResult = {
  status: 'published' | 'failed' | 'in_flight' | 'unknown';
  attemptId?: string;
  startedAt?: string;
  platformPostId?: string;
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
  const status = text(stats.status);
  // Digital-employee calendar entries require an explicit, version-frozen
  // tenant authorization in addition to the human content approval.
  if (text(stats.workflowRunId) && stats.realPublishingAuthorized !== true) return false;
  const scheduledAt = Date.parse(text(post.published_at));
  if (!Number.isFinite(scheduledAt) || scheduledAt > now) return false;
  if (Object.values(resultMap(stats)).some(result => result.status === 'unknown')) return false;
  if (status === 'finalize_pending') {
    const retryAt = Date.parse(text(stats.nextPublishAttemptAt));
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

async function markFailed(post: PostRecord, stats: Record<string, unknown>, attempts: number, message: string): Promise<void> {
  const exhausted = attempts >= MAX_ATTEMPTS;
  const results = resultMap(stats);
  const hasSuccess = Object.values(results).some(result => result.status === 'published');
  const unknown = Object.values(results).some(result => ['unknown', 'in_flight'].includes(result.status));
  if (unknown) for (const result of Object.values(results)) { if (result.status === 'in_flight') result.status = 'unknown'; }
  await store.update('posts', post.id, {
    stats: {
      ...stats,
      status: unknown ? 'needs_attention' : exhausted ? (hasSuccess ? 'partial' : 'failed') : 'failed',
      publishResults: results,
      publishAttempts: attempts,
      publishError: message,
      warnings: [message],
      nextPublishAttemptAt: exhausted ? '' : new Date(Date.now() + scheduledRetryDelay(attempts)).toISOString(),
    },
  });
}

async function publishScheduledPost(post: PostRecord, dependencies: ScheduledPublishingDependencies): Promise<void> {
  const initialStats = statsOf(post);
  const workflowRunId = text(initialStats.workflowRunId);
  if (workflowRunId && await digitalEmployeeRunBlockedReason(post.tenant_id, workflowRunId)) return;
  const attempts = attemptsOf(initialStats) + (text(initialStats.status) === 'finalize_pending' ? 0 : 1);
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
  for (const accountId of accountIds) {
    if (results[accountId]?.status === 'published') continue;
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
      });
      const result = workflowRunId
        ? await withDigitalEmployeeExternalAction(post.tenant_id, workflowRunId, publish)
        : await publish();
      if (!text(result.platformPostId)) throw new Error('平台未返回有效发布回执');
      results[accountId] = {
        status: 'published', attemptId, startedAt: attemptStartedAt,
        platformPostId: result.platformPostId,
        publishedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof WorkflowRunBlockedError) {
        delete results[accountId];
        await store.update('posts', post.id, { stats: {
          ...lockedStats, status: 'scheduled', publishAttempts: attempts - 1,
          publishResults: results, workflowBlockedReason: error.reason,
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
        const runId = text(statsOf(post).workflowRunId);
        if (runId && await digitalEmployeeRunBlockedReason(post.tenant_id, runId)) continue;
        duePosts.push(post);
        if (duePosts.length >= 20) break;
      }
      if (page >= result.totalPages || !result.items.length) break;
    }
    for (const post of duePosts) {
      try {
        await publishScheduledPost(post, dependencies);
      } catch (error) {
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
  if (process.env.PUBLISH_SCHEDULER_ENABLED === 'false') {
    console.log('[publishing-worker] disabled');
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
