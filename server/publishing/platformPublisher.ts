import {
  assertNoUnresolvedPublishing,
  withDirectPublishingLease,
  type DirectPublishingLeaseGuard,
} from './pendingPublishGuard.js';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import { uploadVideoToYouTube, type YouTubeConfig } from '../integrations/youtube.js';
import {
  getTikTokPublishStatus,
  publishInstagramReel,
  uploadFacebookVideo,
  uploadTikTokVideo,
  type SocialPlatform,
  type SocialUploadInput,
} from '../integrations/social.js';
import { recordSuccessfulPublish, type PublishPlatform } from '../lib/publishHistory.js';
import { store } from '../storage/index.js';
import { r2Upload } from '../storage/r2.js';
import { appendTrackedWaLink, createTrackedPostDraft, finalizeTrackedPost, type PostRecord } from './waLink.js';
import {
  freezePublishSourceClaim,
  verifyFrozenPublishSourceClaim,
  type FrozenPublishSourceClaim,
  type PublishSourceRequestKind,
} from './publishSourceClaim.js';
import { socialAccessToken, youtubeCredentials } from '../lib/accountCredentials.js';

const execFileAsync = promisify(execFile);

interface YouTubeAccountRecord {
  id: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken?: string;
  status: 'connected' | 'error' | 'expired';
}

interface SocialAccountRecord {
  id: string;
  tenantId: string;
  platform: SocialPlatform;
  providerAccountId: string;
  accessToken: string;
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
  madeForKids?: boolean;
  projectId?: string;
  generationVersionId?: string;
  generationKind?: 'script' | 'poster';
  generationProvenance?: string;
  qualityStatus?: string;
  publishable?: boolean;
  generationRecordId?: string;
  sourceKind?: PublishSourceRequestKind;
  sourceVideoPath?: string;
  sourceClaim?: FrozenPublishSourceClaim;
  ratio?: string;
  language?: string;
  contentId?: string;
  trackWaLink?: boolean;
  trackingPost?: PostRecord;
  finalizeTracking?: boolean;
  publishAttemptId?: string;
}

export interface PublishToAccountResult {
  video: unknown;
  tracking: PostRecord;
  publishRecord: ReturnType<typeof recordSuccessfulPublish> | null;
  platformPostId: string;
  deliveryStatus?: 'published' | 'provider_accepted';
  providerReceiptId?: string;
  platformUrl?: string;
}

export interface PendingPublishResolution {
  status: 'processing' | 'published' | 'failed' | 'unknown';
  providerReceiptId: string;
  platformPostId: string;
  platformUrl: string;
  providerStatus: string;
  error: string;
}

function publishError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function normalizeVideoPath(input: string): string {
  const raw = input.trim();
  return raw.startsWith('file://') ? fileURLToPath(raw) : path.resolve(raw);
}

function parseTags(tags: unknown, description: string): string[] {
  if (Array.isArray(tags)) return tags.map(String).map(item => item.replace(/^#/, '').trim()).filter(Boolean);
  if (typeof tags === 'string') return tags.split(/[\s,，]+/).map(item => item.replace(/^#/, '').trim()).filter(Boolean);
  return Array.from(description.matchAll(/#([\p{L}\p{N}_-]+)/gu)).map(match => match[1]);
}

function accountStatus(error: any): number {
  return Number(error?.statusCode || error?.response?.status || 500) || 500;
}

async function revalidatePublishSource(input: PublishToAccountInput): Promise<void> {
  if (!input.sourceClaim) throw publishError('发布来源校验记录缺失', 409);
  await verifyFrozenPublishSourceClaim(input.tenantId, input.sourceClaim, input.videoPath);
}

async function trackingPost(input: PublishToAccountInput): Promise<PostRecord> {
  if (input.trackingPost) {
    if (input.trackingPost.tenant_id !== input.tenantId) throw publishError('Scheduled post does not belong to this tenant', 404);
    if (input.trackingPost.platform && input.trackingPost.platform !== input.platform) throw publishError('Scheduled post platform does not match target account', 400);
    return input.trackingPost;
  }
  return createTrackedPostDraft(input.tenantId, {
    contentId: input.contentId,
    platform: input.platform,
    title: input.title,
    language: input.language,
    enabled: input.trackWaLink !== false,
  });
}

function validateLocalVideo(videoPath: string | undefined, extensions: string[], maxMb: number): string {
  if (!videoPath) throw publishError('缺少待发布的视频文件', 400);
  const resolved = normalizeVideoPath(videoPath);
  if (!extensions.includes(path.extname(resolved).toLowerCase())) throw publishError('视频格式不受目标平台支持', 400);
  if (!fs.existsSync(resolved)) throw publishError('待发布视频文件不存在，请重新上传或生成', 404);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw publishError('视频路径不是文件', 400);
  if (stat.size > maxMb * 1024 * 1024) throw publishError(`视频超过 ${maxMb}MB`, 413);
  return resolved;
}

function socialVideoContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.webm') return 'video/webm';
  return 'video/mp4';
}

async function publicVideoUrlIfNeeded(filePath: string | undefined): Promise<string | undefined> {
  if (!filePath) return undefined;
  const publicBase = process.env.R2_PUBLIC_URL?.trim();
  if (!publicBase || !fs.existsSync(filePath)) return undefined;
  const key = `social-publish/${Date.now()}-${path.basename(filePath).replace(/[^\w.-]+/g, '-')}`;
  return r2Upload({ key, body: fs.readFileSync(filePath), contentType: socialVideoContentType(filePath) });
}

async function instagramCompatibleVideo(filePath: string | undefined): Promise<string | undefined> {
  if (!filePath) return undefined;
  const parsed = path.parse(filePath);
  const outputPath = path.join(parsed.dir, `${parsed.name}.instagram.mp4`);
  const sourceStat = fs.statSync(filePath);
  try {
    const outputStat = fs.statSync(outputPath);
    if (outputStat.isFile() && outputStat.size > 0 && outputStat.mtimeMs >= sourceStat.mtimeMs) return outputPath;
  } catch {
    // Build a platform-compatible derivative below.
  }
  const temporaryPath = `${outputPath}.${process.pid}.tmp.mp4`;
  try {
    await execFileAsync(String(ffmpegStatic), [
      '-hide_banner',
      '-loglevel', 'error',
      '-nostdin',
      '-y',
      '-i', filePath,
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
    ], { timeout: 15 * 60_000, maxBuffer: 8 * 1024 * 1024 });
    fs.renameSync(temporaryPath, outputPath);
    return outputPath;
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* best effort */ }
    throw publishError(`Instagram 兼容视频生成失败：${error instanceof Error ? error.message : String(error)}`, 500);
  }
}

function platformContentId(video: any): string {
  return String(video?.id || video?.videoId || video?.publishId || '').trim();
}

function recordObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* empty */ }
  }
  return {};
}

async function persistProviderAccepted(input: {
  request: PublishToAccountInput;
  tracked: PostRecord;
  providerReceiptId: string;
}): Promise<void> {
  if (input.request.finalizeTracking === false) return;
  const now = new Date().toISOString();
  const currentStats = recordObject(input.tracked.stats);
  const publishResults = recordObject(currentStats.publishResults);
  const attemptId = input.request.publishAttemptId || `provider:${input.providerReceiptId}`;
  const updated = await store.update('posts', input.tracked.id, {
    stats: {
      ...currentStats,
      status: 'provider_processing',
      targetAccountIds: [input.request.accountId],
      videoPath: input.request.videoPath || '',
      videoUrl: input.request.videoUrl || '',
      publishAttempts: Math.max(1, Number(currentStats.publishAttempts || 0)),
      publishResults: {
        ...publishResults,
        [input.request.accountId]: {
          status: 'provider_accepted',
          attemptId,
          startedAt: now,
          providerReceiptId: input.providerReceiptId,
          lastCheckedAt: '',
        },
      },
      nextProviderCheckAt: now,
      publishError: '',
      warnings: ['TikTok 已接收上传，正在等待平台发布终态。'],
    },
  });
  if (!updated) {
    throw publishError('TikTok 已接收上传，但本地未能保存处理回执；禁止重复提交，请人工核对', 503);
  }
}

async function beginDirectAttempt(
  input: PublishToAccountInput,
  tracked: PostRecord,
): Promise<{ attemptId: string; startedAt: string } | null> {
  if (input.finalizeTracking === false) return null;
  const attemptId = input.publishAttemptId || `direct:${tracked.id}`;
  const startedAt = new Date().toISOString();
  const currentStats = recordObject(tracked.stats);
  const publishResults = recordObject(currentStats.publishResults);
  const updated = await store.update('posts', tracked.id, {
    stats: {
      ...currentStats,
      status: 'publishing',
      targetAccountIds: [input.accountId],
      videoPath: input.videoPath || '',
      videoUrl: input.videoUrl || '',
      publishAttempts: Math.max(1, Number(currentStats.publishAttempts || 0)),
      publishResults: {
        ...publishResults,
        [input.accountId]: { status: 'in_flight', attemptId, startedAt },
      },
      publishError: '',
      warnings: [],
    },
  });
  if (!updated) throw publishError('无法保存发布尝试，尚未调用平台', 503);
  return { attemptId, startedAt };
}

async function markDirectAttemptNotSubmitted(
  input: PublishToAccountInput,
  tracked: PostRecord,
  attempt: { attemptId: string; startedAt: string } | null,
  error: unknown,
): Promise<void> {
  if (!attempt) return;
  const current = await store.getById<PostRecord>('posts', tracked.id).catch(() => null);
  if (!current) return;
  const stats = recordObject(current.stats);
  const publishResults = recordObject(stats.publishResults);
  const existing = recordObject(publishResults[input.accountId]);
  if (String(existing.attemptId || '') !== attempt.attemptId || existing.status !== 'in_flight') return;
  const message = error instanceof Error && error.message.trim() ? error.message.trim() : '发布安全锁不可用';
  await store.update('posts', tracked.id, {
    stats: {
      ...stats,
      status: 'failed',
      publishResults: {
        ...publishResults,
        [input.accountId]: {
          ...existing,
          status: 'failed',
          error: message,
          failedAt: new Date().toISOString(),
          providerCalled: false,
        },
      },
      publishError: message,
      warnings: [message],
    },
  }).catch(() => undefined);
}

async function markDirectAttemptUnknown(
  input: PublishToAccountInput,
  tracked: PostRecord,
  attempt: { attemptId: string; startedAt: string } | null,
  error: unknown,
): Promise<void> {
  if (!attempt) return;
  const current = await store.getById<PostRecord>('posts', tracked.id).catch(() => null);
  if (!current) return;
  const stats = recordObject(current.stats);
  const publishResults = recordObject(stats.publishResults);
  const existing = recordObject(publishResults[input.accountId]);
  if (String(existing.attemptId || '') !== attempt.attemptId
    || !['in_flight', 'provider_accepted'].includes(String(existing.status || ''))) return;
  const message = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : '平台结果不明，需人工核对';
  await store.update('posts', tracked.id, {
    stats: {
      ...stats,
      status: 'needs_attention',
      publishResults: {
        ...publishResults,
        [input.accountId]: {
          ...existing,
          status: 'unknown',
          error: message,
          failedAt: new Date().toISOString(),
        },
      },
      publishError: '平台结果不明，需核对回执，禁止自动重发',
      warnings: ['平台结果不明，需核对回执，禁止自动重发'],
    },
  }).catch(() => undefined);
}

/** Resolve an already accepted provider receipt without submitting content again. */
export async function resolvePendingPublishToAccount(input: {
  tenantId: string;
  accountId: string;
  platform: PublishPlatform;
  providerReceiptId: string;
}): Promise<PendingPublishResolution> {
  if (input.platform !== 'tiktok') {
    return {
      status: 'unknown',
      providerReceiptId: input.providerReceiptId,
      platformPostId: '',
      platformUrl: '',
      providerStatus: '',
      error: '当前平台不支持自动查询发布终态',
    };
  }
  const account = await store.getById<SocialAccountRecord>('social_accounts', input.accountId);
  if (!account || account.tenantId !== input.tenantId || account.platform !== 'tiktok') {
    throw publishError('TikTok account not found', 404);
  }
  if (account.status !== 'connected') throw publishError('TikTok account is not connected', 400);
  const result = await getTikTokPublishStatus(
    socialAccessToken(account as unknown as Record<string, unknown>),
    input.providerReceiptId,
  );
  return {
    status: result.state,
    providerReceiptId: result.publishId,
    platformPostId: result.platformPostId,
    platformUrl: result.url,
    providerStatus: result.providerStatus,
    error: result.failureReason,
  };
}

async function finalizeIfRequested(input: PublishToAccountInput, tracked: PostRecord, platformPostId: string): Promise<void> {
  if (input.finalizeTracking === false) return;
  const current = await store.getById<PostRecord>('posts', tracked.id);
  const stats = recordObject(current?.stats);
  const publishResults = recordObject(stats.publishResults);
  const existing = recordObject(publishResults[input.accountId]);
  const publishedAt = new Date().toISOString();
  await finalizeTrackedPost(tracked.id, {
    platformPostId,
    title: input.title,
    stats: {
      ...stats,
      status: 'published',
      publishResults: {
        ...publishResults,
        [input.accountId]: { ...existing, status: 'published', platformPostId, publishedAt },
      },
      publishedAt,
      publishError: '',
      warnings: [],
    },
  });
}

async function publishVideoToAccountWithLease(
  input: PublishToAccountInput,
  publishLease: DirectPublishingLeaseGuard,
): Promise<PublishToAccountResult> {
  await assertNoUnresolvedPublishing({ tenantId: input.tenantId, platform: input.platform, accountIds: [input.accountId], contentId: input.contentId, videoPath: input.videoPath, videoUrl: input.videoUrl, currentPostId: input.trackingPost?.id, currentAttemptId: input.publishAttemptId });
  if (input.platform === 'youtube') {
    const account = await store.getById<YouTubeAccountRecord>('youtube_accounts', input.accountId);
    if (!account || account.tenantId !== input.tenantId) throw publishError('YouTube account not found', 404);
    if (account.status !== 'connected') throw publishError('YouTube account is not connected', 400);
    const privacyStatus = input.privacyStatus || 'unlisted';
    if (!['private', 'unlisted', 'public'].includes(privacyStatus)) throw publishError('Invalid YouTube privacy status', 400);
    const filePath = validateLocalVideo(input.videoPath, ['.mp4', '.mov', '.webm', '.mkv', '.avi'], Number(process.env.YOUTUBE_MAX_UPLOAD_MB ?? 2048));
    const tracked = await trackingPost(input);
    const description = appendTrackedWaLink('youtube', input.description || '', tracked.wa_link || '');
    const config: YouTubeConfig = youtubeCredentials(account as unknown as Record<string, unknown>);
    let directAttempt: { attemptId: string; startedAt: string } | null = null;
    let providerStarted = false;
    try {
      directAttempt = await beginDirectAttempt(input, tracked);
      await publishLease.beforeEffect();
      await revalidatePublishSource(input);
      providerStarted = true;
      const video = await uploadVideoToYouTube(config, {
        filePath,
        title: input.title,
        description,
        tags: parseTags(input.tags, description),
        privacyStatus,
        madeForKids: input.madeForKids ?? false,
      });
      const id = platformContentId(video);
      if (!id) throw publishError('YouTube did not return a video id', 502);
      await finalizeIfRequested(input, tracked, id).catch(error => console.error('[publishing] YouTube tracking update failed:', error));
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
      return { video, tracking: tracked, publishRecord, platformPostId: id, deliveryStatus: 'published' };
    } catch (error) {
      if (providerStarted) await markDirectAttemptUnknown(input, tracked, directAttempt, error);
      else await markDirectAttemptNotSubmitted(input, tracked, directAttempt, error);
      const status = accountStatus(error);
      if (status === 401 || status === 403) await store.update('youtube_accounts', input.accountId, { status: 'error' });
      throw error;
    }
  }

  const account = await store.getById<SocialAccountRecord>('social_accounts', input.accountId);
  if (!account || account.tenantId !== input.tenantId || account.platform !== input.platform) throw publishError('Social account not found', 404);
  if (account.status !== 'connected') throw publishError('Social account is not connected', 400);
  const filePath = input.videoPath
    ? validateLocalVideo(input.videoPath, ['.mp4', '.mov', '.webm'], Number(process.env.SOCIAL_MAX_UPLOAD_MB ?? 2048))
    : undefined;
  if (!filePath && !input.videoUrl) throw publishError('缺少待发布的视频文件或公开视频地址', 400);
  if (account.platform === 'tiktok' && !filePath) {
    throw publishError('当前 TikTok 发布实现需要本地视频文件', 400);
  }
  if (account.platform === 'instagram' && !input.videoUrl && !process.env.R2_PUBLIC_URL?.trim()) {
    throw publishError('Instagram 发布需要配置 R2_PUBLIC_URL 或提供公开视频地址', 400);
  }
  const tracked = await trackingPost(input);
  const accessToken = socialAccessToken(account as unknown as Record<string, unknown>);
  const socialInput: SocialUploadInput = {
    filePath,
    videoUrl: input.videoUrl,
    title: input.title,
    description: appendTrackedWaLink(account.platform, input.description || '', tracked.wa_link || ''),
    privacyStatus: input.privacyStatus,
  };
  let directAttempt: { attemptId: string; startedAt: string } | null = null;
  let providerStarted = false;
  try {
    directAttempt = await beginDirectAttempt(input, tracked);
    let video: unknown;
    if (account.platform === 'tiktok') {
      await publishLease.beforeEffect();
      await revalidatePublishSource(input);
      providerStarted = true;
      video = await uploadTikTokVideo(accessToken, socialInput);
    }
    if (account.platform === 'facebook') {
      await publishLease.beforeEffect();
      await revalidatePublishSource(input);
      providerStarted = true;
      video = await uploadFacebookVideo(account.providerAccountId, accessToken, process.env.META_GRAPH_VERSION?.trim() || 'v25.0', socialInput);
    }
    if (account.platform === 'instagram') {
      const compatibleFilePath = socialInput.videoUrl ? undefined : await instagramCompatibleVideo(filePath);
      if (!socialInput.videoUrl) {
        await publishLease.beforeEffect();
        await revalidatePublishSource(input);
        providerStarted = true;
      }
      const publicVideoUrl = socialInput.videoUrl || await publicVideoUrlIfNeeded(compatibleFilePath);
      await publishLease.beforeEffect();
      await revalidatePublishSource(input);
      providerStarted = true;
      video = await publishInstagramReel(account.providerAccountId, accessToken, process.env.META_GRAPH_VERSION?.trim() || 'v25.0', {
        ...socialInput,
        filePath: compatibleFilePath,
        videoUrl: publicVideoUrl,
      });
    }
    const deliveryStatus = (video as { deliveryStatus?: unknown } | undefined)?.deliveryStatus;
    const providerReceiptId = String((video as { providerReceiptId?: unknown } | undefined)?.providerReceiptId || '').trim();
    if (account.platform === 'tiktok' && deliveryStatus === 'provider_accepted') {
      if (!providerReceiptId) throw publishError('TikTok 未返回可恢复的发布回执', 502);
      await persistProviderAccepted({ request: input, tracked, providerReceiptId });
      await store.update('social_accounts', input.accountId, { lastSyncAt: new Date().toISOString(), status: 'connected' })
        .catch(error => console.error('[publishing] TikTok account sync update failed:', error));
      const persistedTracking = input.finalizeTracking === false
        ? tracked
        : await store.getById<PostRecord>('posts', tracked.id) ?? tracked;
      return {
        video,
        tracking: persistedTracking,
        publishRecord: null,
        platformPostId: '',
        deliveryStatus: 'provider_accepted',
        providerReceiptId,
      };
    }
    const id = platformContentId(video);
    if (!video || !id) throw publishError('平台没有返回最终发布内容 id', 502);
    await finalizeIfRequested(input, tracked, id);
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
    return { video, tracking: tracked, publishRecord, platformPostId: id, deliveryStatus: 'published' };
  } catch (error) {
    if (providerStarted) await markDirectAttemptUnknown(input, tracked, directAttempt, error);
    else await markDirectAttemptNotSubmitted(input, tracked, directAttempt, error);
    const status = accountStatus(error);
    if (status === 401 || status === 403) await store.update('social_accounts', input.accountId, { status: 'error' });
    throw error;
  }
}

export async function publishVideoToAccount(input: PublishToAccountInput): Promise<PublishToAccountResult> {
  if (!input.title.trim()) throw publishError('发布标题不能为空', 400);
  const sourceClaim = input.sourceClaim
    ? await verifyFrozenPublishSourceClaim(input.tenantId, input.sourceClaim, input.videoPath)
    : await freezePublishSourceClaim(input.tenantId, input);
  const verifiedInput = { ...input, projectId: sourceClaim.projectId || undefined, sourceClaim };
  return withDirectPublishingLease({
    tenantId: verifiedInput.tenantId,
    platform: verifiedInput.platform,
    accountId: verifiedInput.accountId,
    contentId: verifiedInput.contentId,
    videoPath: verifiedInput.videoPath,
    videoUrl: verifiedInput.videoUrl,
  }, publishLease => publishVideoToAccountWithLease(verifiedInput, publishLease));
}
