import { Router } from 'express';
import path from 'node:path';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { signAssetUrl } from '../lib/assetAccess.js';
import { bindPublishingTargets } from '../digitalEmployees/publishingTargets.js';
import { assertNoUnresolvedPublishing } from '../publishing/pendingPublishGuard.js';
import { externalVideoApprovalHash, externalVideoApprovalSnapshot, externalVideoApprovalValid, externalVideoSha256 } from '../publishing/externalVideoApproval.js';
import { freezePublishSourceClaim, localPublishingVideo, publishingUploadDir, PublishSourceVerificationError, verifyFrozenPublishSourceClaim } from '../publishing/publishSourceClaim.js';
import { createTrackedPostDraft, type PostRecord } from '../publishing/waLink.js';
import { store } from '../storage/index.js';

export const externalVideoApprovalsRouter = Router();
externalVideoApprovalsRouter.use(requireAuth);

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
function parseJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return fallback;
}
function publishingPreviewUrl(tenantId: string, videoPath: unknown): string {
  const localVideo = localPublishingVideo(tenantId, videoPath);
  if (!localVideo) return '';
  const route = `/api/overseas/publishing/local-videos/${encodeURIComponent(path.basename(localVideo))}`;
  return signAssetUrl(route, tenantId, 24 * 60 * 60 * 1000);
}

function externalApprovalResponse(post: PostRecord) {
  const stats = parseJson<Record<string, unknown>>(post.stats, {});
  const results = parseJson<Record<string, Record<string, unknown>>>(stats.publishResults, {});
  const firstAccountId = Array.isArray(stats.targetAccountIds) ? text(stats.targetAccountIds[0]) : '';
  const firstReceipt = results[firstAccountId] || {};
  return {
    id: post.id,
    status: text(stats.status),
    contentHash: text(stats.externalApprovalContentHash),
    videoPreviewUrl: publishingPreviewUrl(post.tenant_id, stats.videoPath),
    platform: post.platform,
    targetAccountIds: stats.targetAccountIds,
    targetAccountLabels: stats.targetAccountLabels,
    title: post.title,
    description: text(stats.description),
    scheduledAt: post.published_at,
    providerReceiptId: text(firstReceipt.providerReceiptId),
    platformPostId: text(firstReceipt.platformPostId) || text(post.platform_post_id),
    platformUrl: text(firstReceipt.platformUrl),
    publishError: text(stats.publishError) || text(firstReceipt.error),
    deliveries: results,
  };
}

externalVideoApprovalsRouter.post('/', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const platform = text(req.body?.platform);
  const videoPath = text(req.body?.videoPath);
  const title = text(req.body?.title);
  const description = text(req.body?.description);
  const scheduledAt = text(req.body?.scheduledAt);
  const accountIds: string[] = Array.isArray(req.body?.targetAccountIds) ? req.body.targetAccountIds.map(text).filter(Boolean) : [];
  if (!['youtube', 'facebook', 'instagram', 'tiktok'].includes(platform) || !title || !videoPath
    || !accountIds.length || !Number.isFinite(Date.parse(scheduledAt)) || Date.parse(scheduledAt) <= Date.now()) {
    res.status(400).json({ error: 'external_video_approval_fields_invalid' });
    return;
  }
  try {
    const sourceClaim = await freezePublishSourceClaim(tenantId, { sourceKind: 'manual_upload', videoPath });
    const { targets, invalidAccountIds } = await bindPublishingTargets(tenantId, accountIds.map(accountId => ({ platform: platform as 'youtube' | 'facebook' | 'instagram' | 'tiktok', accountId, accountLabel: '' })));
    if (invalidAccountIds.length || targets.length !== new Set(accountIds).size) {
      res.status(409).json({ error: 'external_video_accounts_not_connected' });
      return;
    }
    const controlledVideoPath = sourceClaim.deliveryVideoPath;
    const sha256 = await externalVideoSha256(controlledVideoPath);
    const post = await createTrackedPostDraft(tenantId, { platform, title, enabled: req.body?.trackWaLink === true }, {
      published_at: scheduledAt,
      stats: {
        origin: 'authorized_external_video', status: 'awaiting_approval',
        description, firstComment: text(req.body?.firstComment), videoPath: controlledVideoPath,
        videoSha256: sha256, publishSourceClaim: sourceClaim,
        targetAccountIds: targets.map(target => target.accountId),
        targetAccountLabels: targets.map(target => target.accountLabel),
        trackWaLink: req.body?.trackWaLink === true,
        scheduleLocked: true, publishAttempts: 0, publishResults: {},
        externalCreatedBy: userId,
      },
    });
    const stats = parseJson<Record<string, unknown>>(post.stats, {});
    const contentHash = externalVideoApprovalHash(externalVideoApprovalSnapshot(post));
    const saved = await store.update('posts', post.id, { stats: { ...stats, externalApprovalContentHash: contentHash } });
    if (!saved) throw new Error('external_video_approval_persist_failed');
    const updated = await store.getById<PostRecord>('posts', post.id);
    if (!updated) throw new Error('external_video_approval_readback_failed');
    res.status(201).json({ approval: externalApprovalResponse(updated) });
  } catch (error) {
    const status = error instanceof PublishSourceVerificationError ? error.statusCode : 500;
    res.status(status).json({ error: error instanceof PublishSourceVerificationError ? error.code : 'external_video_approval_failed' });
  }
});

externalVideoApprovalsRouter.get('/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const post = await store.getById<PostRecord>('posts', String(req.params.id));
  const stats = post ? parseJson<Record<string, unknown>>(post.stats, {}) : {};
  if (!post || post.tenant_id !== tenantId || stats.origin !== 'authorized_external_video') {
    res.status(404).json({ error: 'external_video_approval_not_found' }); return;
  }
  res.json({ approval: externalApprovalResponse(post) });
});

externalVideoApprovalsRouter.post('/:id/approve', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const post = await store.getById<PostRecord>('posts', String(req.params.id));
  const stats = post ? parseJson<Record<string, unknown>>(post.stats, {}) : {};
  if (!post || post.tenant_id !== tenantId || stats.origin !== 'authorized_external_video') {
    res.status(404).json({ error: 'external_video_approval_not_found' }); return;
  }
  const contentHash = externalVideoApprovalHash(externalVideoApprovalSnapshot(post));
  if (stats.status !== 'awaiting_approval' || text(req.body?.contentHash) !== contentHash
    || text(stats.externalApprovalContentHash) !== contentHash) {
    res.status(409).json({ error: 'external_video_approval_stale' }); return;
  }
  if (Date.parse(text(post.published_at)) <= Date.now()) {
    res.status(409).json({ error: 'external_video_schedule_expired', message: '计划时间已过，请重新建单审批。' }); return;
  }
  try {
    await verifyFrozenPublishSourceClaim(tenantId, stats.publishSourceClaim, stats.videoPath);
    if (await externalVideoSha256(text(stats.videoPath)) !== stats.videoSha256) {
      res.status(409).json({ error: 'external_video_changed' }); return;
    }
    const accountIds = Array.isArray(stats.targetAccountIds) ? stats.targetAccountIds.map(text).filter(Boolean) : [];
    const { targets, invalidAccountIds } = await bindPublishingTargets(tenantId, accountIds.map(accountId => ({ platform: post.platform as 'youtube' | 'facebook' | 'instagram' | 'tiktok', accountId, accountLabel: '' })));
    if (invalidAccountIds.length || targets.length !== accountIds.length) {
      res.status(409).json({ error: 'external_video_accounts_not_connected' }); return;
    }
    await assertNoUnresolvedPublishing({ tenantId, platform: post.platform, accountIds, videoPath: text(stats.videoPath), currentPostId: post.id });
    const saved = await store.update('posts', post.id, { stats: {
      ...stats, status: 'scheduled', externalApprovalStatus: 'approved',
      externalApprovedContentHash: contentHash, externalApprovedAt: new Date().toISOString(),
      externalApprovedBy: userId,
    } });
    if (!saved) throw new Error('external_video_approval_persist_failed');
    const updated = await store.getById<PostRecord>('posts', post.id);
    if (!updated || !externalVideoApprovalValid(updated)) throw new Error('external_video_approval_persist_failed');
    res.json({ approval: externalApprovalResponse(updated), calendarPostId: updated.id });
  } catch (error) {
    const status = error instanceof PublishSourceVerificationError ? error.statusCode : 409;
    res.status(status).json({ error: error instanceof Error ? error.message : 'external_video_approval_failed' });
  }
});

