import { Router, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { callLLM } from '../agents/llm.js';
import { compareAndSetRecord } from '../digitalEmployees/reliableKernel.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { signAssetUrl } from '../lib/assetAccess.js';
import { writeAuditLog } from '../lib/auditLog.js';
import { getBestTimeScores } from '../publishing/bestTime.js';
import {
  PUBLISH_COPY_PLATFORMS,
  normalizePlatformCopies,
  sanitizePublishCopyPlatforms,
  type PlatformCopy,
  type PublishCopyPlatform,
} from '../publishing/copyAdaptation.js';
import { createTrackedPostDraft, type PostRecord } from '../publishing/waLink.js';
import {
  activatePreparedScheduledPost,
  createScheduledPost,
  listTenantCalendarPosts,
  schedulePayloadHash,
  validateScheduledTikTokPublishOptions,
  type SchedulePostInput,
} from '../publishing/scheduleService.js';
import { isDigitalEmployeePostStats } from '../publishing/postMutationPolicy.js';
import {
  PUBLISH_VIDEO_EXTENSIONS,
  hasSupportedVideoContainerSignature,
  normalizeApprovedPublicVideoUrl,
  publishingUploadDir,
  publishingVideoReference,
  resolveTenantPublishingVideo,
  tenantPublishingVideoSha256,
} from '../publishing/localVideoSecurity.js';
import { publicPublishingStats } from '../publishing/publicPublication.js';
import { store } from '../storage/index.js';
import { requestOrganizationRoleStrict } from './auth.js';
import { RecordScanLimitError } from '../storage/pagination.js';
import {
  attachPublishContentFences,
  durablePostContentFenceKeys,
  publishContentFenceKey,
  PublishContentFenceError,
  releasePostContentFences,
  releaseSpecificPostContentFences,
  releasePublishContentReservations,
  reservePublishContentFences,
} from '../publishing/publishContentFence.js';
import { withPublishQueueProjection } from '../publishing/publishQueueProjection.js';

export const publishingRouter = Router();
const MAX_CALENDAR_TARGET_ACCOUNTS = 100;

interface RecycleListRecord {
  id: string;
  tenant_id: string;
  name: string;
  enabled?: boolean;
  items?: Array<{ contentId: string; paused?: boolean; title?: string; coverUrl?: string }>;
  slots?: Array<{ weekday: number; time: string; platforms: string[] }>;
  refresh_mode?: 'copy' | 'copy_cover' | 'copy_cover_hook';
  cursor?: number;
  created?: string;
  updated?: string;
}

interface PostingScheduleRecord {
  id: string;
  tenant_id: string;
  platform: string;
  market: string;
  time_zone: string;
  utc_offset: number;
  preset: 'light' | 'standard' | 'high';
  slots: Array<{ weekday: number; time: string }>;
  created?: string;
  updated?: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number {
  const next = Number(value || 0);
  return Number.isFinite(next) ? next : 0;
}

function requestExpectedRevision(req: Request): number | null {
  const rawHeader = text(req.headers['if-match']).replace(/^W\//, '').replace(/^"|"$/g, '');
  const raw = req.body?.expectedRevision ?? req.query.expectedRevision ?? (rawHeader || undefined);
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function requireExpectedRevision(req: Request, res: Response, post: PostRecord): number | null {
  const expectedRevision = requestExpectedRevision(req);
  if (expectedRevision === null) {
    res.status(428).json({
      error: 'expected_revision_required',
      currentRevision: Number(post.publish_revision || 0),
    });
    return null;
  }
  if (expectedRevision !== Number(post.publish_revision || 0)) {
    res.status(409).json({
      error: 'calendar_post_revision_conflict',
      currentRevision: Number(post.publish_revision || 0),
    });
    return null;
  }
  return expectedRevision;
}

async function cleanupMutationContentFences(
  postId: string,
  candidateFenceKeys: string[],
  requireExecutable = false,
): Promise<void> {
  const current = await store.getById<PostRecord>('posts', postId);
  const durableKeys = current ? durablePostContentFenceKeys(current, requireExecutable) : [];
  await releaseSpecificPostContentFences(store, postId, candidateFenceKeys, durableKeys);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function localPublishingVideo(tenantId: string, videoPath: unknown): string | null {
  return resolveTenantPublishingVideo(tenantId, videoPath);
}

function publishingPreviewUrl(tenantId: string, videoPath: unknown): string {
  const localVideo = localPublishingVideo(tenantId, videoPath);
  if (!localVideo) return '';
  const route = `/api/overseas/publishing/local-videos/${encodeURIComponent(path.basename(localVideo))}`;
  return signAssetUrl(route, tenantId, 24 * 60 * 60 * 1000);
}

function publicPost(post: PostRecord) {
  const durableStats = parseJson<Record<string, unknown>>(post.stats, {});
  const stats = publicPublishingStats(post);
  return {
    id: post.id,
    contentId: text(post.content_id),
    platform: text(post.platform),
    platformPostId: text(post.platform_post_id),
    title: text(post.title) || text(post.track_code),
    description: text(stats.description),
    publishedAt: text(post.published_at || post.created),
    trackCode: text(post.track_code),
    waLink: text(post.wa_link),
    stats,
    status: text(stats.status) || (post.platform_post_id ? 'published' : 'scheduled'),
    coverUrl: text(stats.coverUrl),
    videoUrl: text(stats.videoUrl || stats.mediaUrl || stats.url),
    duration: numberValue(stats.duration),
    firstComment: text(stats.firstComment),
    videoPath: publishingVideoReference(post.tenant_id, durableStats.videoPath),
    videoPreviewUrl: publishingPreviewUrl(post.tenant_id, durableStats.videoPath) || text(stats.videoPreviewUrl),
    trackWaLink: stats.trackWaLink !== false,
    scheduleLocked: Boolean(stats.scheduleLocked),
    targetAccountIds: Array.isArray(stats.targetAccountIds) ? stats.targetAccountIds.map(String).map(text).filter(Boolean) : [],
    targetAccountLabels: Array.isArray(stats.targetAccountLabels) ? stats.targetAccountLabels.map(String).map(text).filter(Boolean) : [],
    warnings: Array.isArray(stats.warnings) ? stats.warnings : [],
    publishError: text(stats.publishError),
    publishAttempts: numberValue(stats.publishAttempts),
    nextPublishAttemptAt: text(stats.nextPublishAttemptAt),
    publishRevision: Number(post.publish_revision || 0),
    reconciliationRequired: post.reconciliation_required === true,
    isRecycle: Boolean(stats.isRecycle),
    inquiries: numberValue(post.inquiries),
    deals: numberValue(post.deals),
  };
}

function publicPostingSchedule(item: Partial<PostingScheduleRecord>) {
  const preset: PostingScheduleRecord['preset'] = item.preset === 'light' || item.preset === 'high'
    ? item.preset
    : 'standard';
  return {
    id: text(item.id),
    platform: text(item.platform) || 'tiktok',
    market: text(item.market) || 'global',
    time_zone: text(item.time_zone) || 'UTC',
    utc_offset: Math.max(-12, Math.min(14, numberValue(item.utc_offset))),
    preset,
    slots: normalizeScheduleSlots(item.slots, preset),
  };
}

function hasPublishedTargets(post: PostRecord): boolean {
  if (text(post.platform_post_id)) return true;
  const stats = parseJson<Record<string, unknown>>(post.stats, {});
  const results = stats.publishResults;
  if (!results || typeof results !== 'object' || Array.isArray(results)) return false;
  return Object.values(results).some(result => {
    return Boolean(result && typeof result === 'object' && text((result as Record<string, unknown>).status) === 'published');
  });
}

function isPublishingPost(post: PostRecord): boolean {
  const stats = parseJson<Record<string, unknown>>(post.stats, {});
  return text(stats.status) === 'publishing';
}

async function validateTargetAccountBindings(
  tenantId: string,
  platform: string,
  accountIds: string[],
): Promise<boolean> {
  if (!accountIds.length || accountIds.length > MAX_CALENDAR_TARGET_ACCOUNTS) return false;
  const records = await Promise.all(accountIds.map(accountId => (
    platform === 'youtube'
      ? store.getById<Record<string, unknown> & { id: string }>('youtube_accounts', accountId)
      : store.getById<Record<string, unknown> & { id: string }>('social_accounts', accountId)
  )));
  return records.every((record, index) => {
    if (!record || record.id !== accountIds[index]) return false;
    const recordTenantId = text(record.tenantId || record.tenant_id);
    if (recordTenantId !== tenantId) return false;
    return platform === 'youtube' || text(record.platform) === platform;
  });
}

function scheduleContentDigest(videoSha256: string, _videoUrl: string): string {
  if (/^[a-f0-9]{64}$/.test(videoSha256)) return videoSha256;
  return '';
}

function presetSchedule(preset: PostingScheduleRecord['preset'] = 'standard'): Array<{ weekday: number; time: string }> {
  const weekdays = preset === 'light' ? [1, 3, 5] : preset === 'high' ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
  return weekdays.map(weekday => ({ weekday, time: '20:00' }));
}

function normalizeScheduleSlots(value: unknown, preset: PostingScheduleRecord['preset']): Array<{ weekday: number; time: string }> {
  if (!Array.isArray(value)) return presetSchedule(preset);
  const slots = value
    .map(slot => ({
      weekday: Math.max(0, Math.min(6, Number(slot?.weekday) || 0)),
      time: /^\d{2}:\d{2}$/.test(text(slot?.time)) ? text(slot?.time) : '20:00',
    }))
    .filter((slot, index, list) => list.findIndex(item => item.weekday === slot.weekday && item.time === slot.time) === index)
    .sort((left, right) => left.weekday - right.weekday || left.time.localeCompare(right.time));
  return slots.length ? slots : presetSchedule(preset);
}

function fallbackQueueSuggestion(input: {
  currentTitle: string;
  feedback: string;
  festival: string;
}): { title: string; brief: string; tags: string[] } {
  const variants = [
    { title: '主推产品：3 个采购决策点', brief: '用买家视角拆解用途、采购关注点和询盘入口，不补写未确认参数。', tags: ['主推品', '采购决策'] },
    { title: '工厂能力：从打样到交付', brief: '展示流程与交付节点，企业资料缺失的部分保持待确认。', tags: ['工厂实力', '交付'] },
    { title: '采购 FAQ：MOQ、定制与样品', brief: '围绕高频询盘组织短内容，引导买家索取目录和报价。', tags: ['采购FAQ', '询盘'] },
    { title: '质量证明：细节、包装与检验', brief: '用可拍摄的细节建立信任，只引用企业中心已有事实。', tags: ['质量', '信任'] },
    { title: '应用场景：买家如何使用这款产品', brief: '从真实使用场景切入，结尾保留清晰的 WhatsApp 询盘动作。', tags: ['场景', '转化'] },
  ];
  const currentIndex = variants.findIndex(item => item.title === input.currentTitle);
  const selected = variants[(currentIndex + 1 + variants.length) % variants.length];
  if (input.feedback) {
    return {
      title: selected.title,
      brief: `${selected.brief} 修改要求：${input.feedback.slice(0, 120)}`,
      tags: selected.tags,
    };
  }
  if (input.festival) {
    return {
      title: `${input.festival}：采购准备清单`,
      brief: '围绕节庆采购窗口组织备货、交付与询盘内容，不虚构折扣或库存。',
      tags: ['节庆', '备货'],
    };
  }
  return selected;
}

publishingRouter.use(requireAuth);
publishingRouter.use(async (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { next(); return; }
  const { userId, supportAccess } = res.locals as AuthLocals;
  if (supportAccess) { res.status(403).json({ error: 'support_access_read_only' }); return; }
  const role = await requestOrganizationRoleStrict(req.headers.authorization, userId);
  if (!role || !['super_admin', 'admin', 'social_operator'].includes(role)) {
    res.status(403).json({ error: 'publishing_write_forbidden' });
    return;
  }
  next();
});

publishingRouter.get('/local-videos/:filename', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const filename = path.basename(String(req.params.filename || ''));
  const filePath = localPublishingVideo(tenantId, path.join(publishingUploadDir(tenantId), filename));
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.status(404).json({ error: 'video_not_found' });
    return;
  }
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.sendFile(filePath);
});

publishingRouter.post('/local-videos', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const encodedName = text(req.headers['x-file-name']);
  let originalName = 'video.mp4';
  try {
    originalName = decodeURIComponent(encodedName || originalName);
  } catch {
    originalName = encodedName || originalName;
  }
  originalName = path.basename(originalName).replace(/[^\w.\-\u4e00-\u9fff]+/g, '-');
  const ext = path.extname(originalName).toLowerCase();
  if (!PUBLISH_VIDEO_EXTENSIONS.has(ext)) {
    res.status(400).json({ error: '仅支持 mp4、mov、webm、mkv、avi 视频文件' });
    return;
  }
  const maxBytes = Math.max(50, Number(process.env.PUBLISH_UPLOAD_MAX_MB || 2048)) * 1024 * 1024;
  const declaredBytes = Number(req.headers['content-length'] || 0);
  if (declaredBytes > maxBytes) {
    res.status(413).json({ error: `视频不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB` });
    return;
  }
  const outputDir = publishingUploadDir(tenantId);
  const outputPath = path.join(outputDir, `${randomUUID()}-${originalName}`);
  fs.mkdirSync(outputDir, { recursive: true });
  let receivedBytes = 0;
  const limiter = async function* (source: AsyncIterable<Buffer>) {
    for await (const chunk of source) {
      receivedBytes += chunk.length;
      if (receivedBytes > maxBytes) throw Object.assign(new Error('video_too_large'), { statusCode: 413 });
      yield chunk;
    }
  };
  try {
    await pipeline(req, limiter, fs.createWriteStream(outputPath));
    if (!receivedBytes) throw new Error('empty_video');
    if (!hasSupportedVideoContainerSignature(outputPath)) throw new Error('invalid_video_container');
    res.status(201).json({
      ok: true,
      video: {
        name: originalName,
        videoPath: publishingVideoReference(tenantId, outputPath),
        previewUrl: publishingPreviewUrl(tenantId, outputPath),
        size: receivedBytes,
      },
    });
  } catch (error: any) {
    try { fs.rmSync(outputPath, { force: true }); } catch { /* ignore */ }
    const status = Number(error?.statusCode) || 400;
    res.status(status).json({ error: error?.message === 'empty_video' ? '视频文件为空' : error?.message === 'video_too_large' ? '视频文件过大' : error?.message === 'invalid_video_container' ? '文件内容不是受支持的视频容器' : '视频接收失败' });
  }
});

publishingRouter.post('/local-videos/import-rendered', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const sourceRoot = path.resolve('/root/Downloads/lingshu-ai-exports');
  const outputDir = publishingUploadDir(tenantId);
  fs.mkdirSync(outputDir, { recursive: true });
  const requestedPaths: string[] = Array.isArray(req.body?.videoPaths) ? req.body.videoPaths.map(text).filter(Boolean).slice(0, 200) : [];
  const videos = requestedPaths.map((sourcePath, inputIndex) => {
    const existingTenantVideo = resolveTenantPublishingVideo(tenantId, sourcePath);
    if (existingTenantVideo) {
      return {
        inputIndex,
        videoPath: publishingVideoReference(tenantId, existingTenantVideo),
        previewUrl: publishingPreviewUrl(tenantId, existingTenantVideo),
      };
    }
    // Production accepts only tenant-scoped opaque references or legacy paths
    // that still resolve inside this tenant's upload root. The historical
    // shared Downloads import is a local-development compatibility path and
    // must never become a cross-tenant file oracle.
    if (process.env.NODE_ENV === 'production') return { inputIndex, error: 'legacy_render_import_disabled' };
    const filename = path.basename(sourcePath);
    const ext = path.extname(filename).toLowerCase();
    if (!PUBLISH_VIDEO_EXTENSIONS.has(ext)) return { inputIndex, error: 'unsupported_video' };
    let resolvedSource = '';
    let realSourceRoot = '';
    try {
      resolvedSource = fs.realpathSync(path.resolve(sourcePath));
      realSourceRoot = fs.realpathSync(sourceRoot);
    } catch {
      return { inputIndex, error: 'video_not_found' };
    }
    if (!resolvedSource.startsWith(`${realSourceRoot}${path.sep}`)
      || fs.lstatSync(resolvedSource).isSymbolicLink()
      || !fs.statSync(resolvedSource).isFile()
      || !hasSupportedVideoContainerSignature(resolvedSource)) {
      return { inputIndex, error: 'video_not_found' };
    }
    const targetPath = path.join(outputDir, `${randomUUID()}-${filename}`);
    fs.copyFileSync(resolvedSource, targetPath, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(targetPath, 0o600);
    return {
      inputIndex,
      videoPath: publishingVideoReference(tenantId, targetPath),
      previewUrl: publishingPreviewUrl(tenantId, targetPath),
    };
  });
  res.json({ ok: true, videos });
});

publishingRouter.get('/best-time', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const platform = text(req.query.platform) || 'tiktok';
  const weekday = Math.max(0, Math.min(6, Number(req.query.weekday ?? new Date().getDay()) || 0));
  const offsetValue = text(req.query.utcOffset);
  const parsedOffset = offsetValue ? Number(offsetValue) : Number.NaN;
  const utcOffset = Number.isFinite(parsedOffset) ? Math.max(-12, Math.min(14, parsedOffset)) : undefined;
  res.json({
    platform,
    weekday,
    scores: getBestTimeScores(tenantId, platform, weekday, utcOffset),
    source: 'platform_reference',
    confidence: 'reference',
    utcOffset: utcOffset ?? null,
  });
});

publishingRouter.get('/posting-schedule', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const platform = text(req.query.platform) || 'tiktok';
  const result = await store.list<PostingScheduleRecord>('publishing_schedules', {
    where: { tenant_id: tenantId, platform },
    perPage: 1,
    sort: '-updated',
  });
  const item = result.items[0];
  res.json({
    item: publicPostingSchedule(item || {
      id: '',
      tenant_id: tenantId,
      platform,
      market: 'global',
      time_zone: 'UTC',
      utc_offset: 0,
      preset: 'standard',
      slots: presetSchedule('standard'),
    }),
  });
});

publishingRouter.put('/posting-schedule', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const platform = (text(req.body?.platform) || 'tiktok').toLowerCase();
  const requestedPreset = text(req.body?.preset);
  const preset: PostingScheduleRecord['preset'] = requestedPreset === 'light' || requestedPreset === 'high' ? requestedPreset : 'standard';
  const next = {
    tenant_id: tenantId,
    platform,
    market: text(req.body?.market) || 'global',
    time_zone: text(req.body?.timeZone || req.body?.time_zone) || 'UTC',
    utc_offset: Math.max(-12, Math.min(14, numberValue(req.body?.utcOffset ?? req.body?.utc_offset))),
    preset,
    slots: normalizeScheduleSlots(req.body?.slots, preset),
  };
  const result = await store.list<PostingScheduleRecord>('publishing_schedules', {
    where: { tenant_id: tenantId, platform },
    perPage: 1,
    sort: '-updated',
  });
  const existing = result.items[0];
  if (existing) {
    await store.update('publishing_schedules', existing.id, next);
    const item = await store.getById<PostingScheduleRecord>('publishing_schedules', existing.id);
    res.json({ item: publicPostingSchedule(item || { ...existing, ...next }) });
    return;
  }
  const item = await store.create<PostingScheduleRecord>('publishing_schedules', next);
  res.status(201).json({ item: publicPostingSchedule(item || { id: '', ...next }) });
});

publishingRouter.get('/calendar', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const from = Date.parse(text(req.query.from)) || Date.now() - 7 * 86_400_000;
  const to = Date.parse(text(req.query.to)) || Date.now() + 35 * 86_400_000;
  let records: PostRecord[];
  try {
    records = await listTenantCalendarPosts(store, tenantId);
  } catch (error) {
    if (error instanceof RecordScanLimitError) {
      res.status(503).json({ error: 'calendar_record_scan_limit_exceeded', message: '日历记录超过安全扫描上限，请联系管理员归档后重试。' });
      return;
    }
    throw error;
  }
  const items = records
    .map(publicPost)
    .filter(item => {
      if (item.stats.calendarHidden === true) return false;
      const time = Date.parse(item.publishedAt || '');
      return Number.isFinite(time) && time >= from && time <= to;
    });
  res.json({ items });
});

publishingRouter.post('/calendar', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const scheduledAt = text(req.body?.scheduledAt);
  const platform = text(req.body?.platform) || 'tiktok';
  const title = text(req.body?.title) || 'Untitled content';
  const idempotencyKey = text(req.body?.idempotencyKey);
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(idempotencyKey)) {
    res.status(400).json({ error: 'valid_idempotency_key_required' });
    return;
  }
  if (!scheduledAt) {
    res.status(400).json({ error: 'scheduled_at_required' });
    return;
  }
  const requestedVideoPath = text(req.body?.videoPath);
  const videoPath = requestedVideoPath ? resolveTenantPublishingVideo(tenantId, requestedVideoPath) || '' : '';
  if (requestedVideoPath && !videoPath) {
    res.status(400).json({ error: 'video_path_outside_tenant_storage' });
    return;
  }
  const requestedVideoUrl = text(req.body?.videoUrl);
  const normalizedVideoUrl = requestedVideoUrl ? normalizeApprovedPublicVideoUrl(requestedVideoUrl) || '' : '';
  if (requestedVideoUrl && !normalizedVideoUrl) {
    res.status(400).json({ error: 'video_url_origin_not_allowed' });
    return;
  }
  const videoUrl = videoPath ? '' : normalizedVideoUrl;
  const targetAccountIds = Array.isArray(req.body?.targetAccountIds)
    ? Array.from(new Set<string>(req.body.targetAccountIds.map(String).map(text).filter(Boolean)))
    : [];
  const targetAccountLabels = Array.isArray(req.body?.targetAccountLabels)
    ? req.body.targetAccountLabels.map(String).map(text).filter(Boolean)
    : [];
  if (!targetAccountIds.length) {
    res.status(400).json({ error: 'target_account_required' });
    return;
  }
  if (targetAccountIds.length > MAX_CALENDAR_TARGET_ACCOUNTS) {
    res.status(400).json({ error: 'target_account_limit_exceeded', limit: MAX_CALENDAR_TARGET_ACCOUNTS });
    return;
  }
  if (!await validateTargetAccountBindings(tenantId, platform, targetAccountIds)) {
    res.status(400).json({ error: 'target_accounts_do_not_match_tenant_platform' });
    return;
  }
  let tiktokPublishOptionsByAccount;
  try {
    tiktokPublishOptionsByAccount = validateScheduledTikTokPublishOptions({
      platform,
      targetAccountIds,
      value: req.body?.tiktokPublishOptionsByAccount,
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'tiktok_publish_options_invalid' });
    return;
  }
  const videoIdentity = videoPath ? await tenantPublishingVideoSha256(tenantId, videoPath) : null;
  const videoSha256 = videoIdentity?.sha256 || '';
  if (!videoIdentity) {
    res.status(400).json({
      error: 'immutable_local_video_required',
      message: '生产发布必须先导入本地不可变视频并校验字节摘要，不能直接排期可变 URL。',
    });
    return;
  }
  const contentDigest = scheduleContentDigest(videoSha256, videoUrl);
  if (!contentDigest) {
    res.status(400).json({ error: 'publishing_content_digest_required' });
    return;
  }
  const contentFenceKeys = targetAccountIds.map(accountId => publishContentFenceKey({
    tenantId, platform, accountId, contentDigest,
  })).sort();
  let reservation;
  let prepared: PostRecord | undefined;
  try {
    prepared = await createScheduledPost({
      tenantId, contentId: text(req.body?.contentId), platform, title, scheduledAt, language: text(req.body?.language),
      coverUrl: text(req.body?.coverUrl), description: text(req.body?.description), firstComment: text(req.body?.firstComment),
      videoPath: videoIdentity?.filePath || videoPath, videoUrl, videoSha256, publishContentDigest: contentDigest,
      contentFenceKeys,
      ...(platform === 'tiktok' ? { tiktokPublishOptionsByAccount } : {}),
      trackWaLink: req.body?.trackWaLink !== false,
      scheduleLocked: req.body?.scheduleLocked === true,
      targetAccountIds, targetAccountLabels, source: 'manual', idempotencyKey,
    });
    reservation = await reservePublishContentFences({
      dataStore: store,
      tenantId,
      platform,
      accountIds: targetAccountIds,
      contentDigest,
      ownerKey: idempotencyKey,
    });
    await attachPublishContentFences(store, reservation.records, idempotencyKey, prepared.id);
    const saved = await activatePreparedScheduledPost(prepared, store);
    res.status(201).json({ item: publicPost(saved) });
  } catch (error) {
    if (reservation) {
      if (prepared) {
        await cleanupMutationContentFences(
          prepared.id,
          reservation.records.map(record => record.fence_key),
          true,
        ).catch(() => undefined);
      }
      await releasePublishContentReservations(store, reservation.createdIds, idempotencyKey).catch(() => undefined);
    }
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof PublishContentFenceError) {
      res.status(409).json({ error: error.code, conflictingPostId: error.postId });
      return;
    }
    if (['scheduled_post_idempotency_payload_conflict', 'scheduled_post_persistence_conflict'].includes(message)) {
      res.status(409).json({ error: message });
      return;
    }
    if (['scheduled_at_invalid', 'platform_required', 'target_account_required', 'video_path_outside_tenant_storage', 'video_url_origin_not_allowed',
      'tiktok_publish_options_required', 'tiktok_privacy_level_required', 'tiktok_user_consent_required',
      'tiktok_unaudited_self_only_required', 'tiktok_branded_content_private_invalid'].includes(message)) {
      res.status(400).json({ error: message });
      return;
    }
    throw error;
  }
});

publishingRouter.post('/calendar/:id/retry', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const post = await store.getById<PostRecord>('posts', String(req.params.id));
  if (!post || post.tenant_id !== tenantId) {
    res.status(404).json({ error: 'post_not_found' });
    return;
  }
  if (requireExpectedRevision(req, res, post) === null) return;
  const stats = parseJson<Record<string, unknown>>(post.stats, {});
  if (post.reconciliation_required === true || text(stats.status) === 'needs_reconciliation') {
    res.status(409).json({
      error: 'post_requires_reconciliation_before_retry',
      message: '平台结果不确定，必须先按账号完成发布对账，不能直接重试。',
    });
    return;
  }
  if (isDigitalEmployeePostStats(stats)) {
    res.status(409).json({
      error: 'digital_employee_retry_requires_reconciliation',
      message: '数字员工排期只能在人工对账确认全部账号均未发布后安全重试。',
    });
    return;
  }
  if (!['failed', 'partial'].includes(text(stats.status))) {
    res.status(409).json({ error: 'post_is_not_retryable' });
    return;
  }
  await writeAuditLog({
    tenantId,
    actorUserId: userId,
    action: 'publishing.calendar_retry_requested',
    targetType: 'post',
    targetId: post.id,
    metadata: { publishRevision: Number(post.publish_revision || 0), priorStatus: text(stats.status) },
  });
  const requestedAt = new Date().toISOString();
  const retried = await compareAndSetRecord<PostRecord>({
    store,
    collection: 'posts',
    id: post.id,
    expected: {
      publish_revision: Number(post.publish_revision || 0),
      publish_lease_owner: post.publish_lease_owner || '',
      publish_lease_expires_at: post.publish_lease_expires_at || '',
    },
    patch: withPublishQueueProjection(post, {
      publish_revision: Number(post.publish_revision || 0) + 1,
      publish_lease_owner: '',
      publish_lease_expires_at: '',
      reconciliation_required: false,
      stats: {
        ...stats,
        status: 'failed',
        publishAttempts: 0,
        publishError: '',
        nextPublishAttemptAt: requestedAt,
        warnings: [],
        manualRetryRequestedAt: requestedAt,
        manualRetryRequestedBy: userId,
      },
    }),
  });
  if (!retried.ok) {
    res.status(409).json({ error: 'calendar_post_retry_conflict' });
    return;
  }
  await writeAuditLog({
    tenantId,
    actorUserId: userId,
    action: 'publishing.calendar_retry_scheduled',
    targetType: 'post',
    targetId: post.id,
    metadata: { publishRevision: Number(retried.record.publish_revision || 0), priorStatus: text(stats.status) },
  });
  res.json({ item: publicPost(retried.record) });
});

publishingRouter.delete('/calendar/:id', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const post = await store.getById<PostRecord>('posts', String(req.params.id));
  if (!post || post.tenant_id !== tenantId) {
    res.status(404).json({ error: 'post_not_found' });
    return;
  }
  if (requireExpectedRevision(req, res, post) === null) return;
  const stats = parseJson<Record<string, unknown>>(post.stats, {});
  if (post.reconciliation_required === true || text(stats.status) === 'needs_reconciliation') {
    res.status(409).json({
      error: 'publishing_reconciliation_required_before_cancel',
      message: '平台结果不确定，必须先按账号完成发布对账，不能直接移除证据。',
    });
    return;
  }
  if (isDigitalEmployeePostStats(stats)) {
    res.status(409).json({
      error: 'digital_employee_schedule_cannot_be_deleted',
      message: '数字员工排期保留为审批与对账证据；请在数字员工待办中完成对账或作废。',
    });
    return;
  }
  if (hasPublishedTargets(post)) {
    res.status(409).json({ error: 'published_post_cannot_be_removed' });
    return;
  }
  if (isPublishingPost(post)) {
    res.status(409).json({ error: 'publishing_post_cannot_be_removed' });
    return;
  }
  await writeAuditLog({
    tenantId,
    actorUserId: userId,
    action: 'publishing.calendar_cancel_requested',
    targetType: 'post',
    targetId: post.id,
    metadata: { publishRevision: Number(post.publish_revision || 0) },
  });
  const now = new Date().toISOString();
  const cancelled = await compareAndSetRecord<PostRecord>({
    store,
    collection: 'posts',
    id: post.id,
    expected: {
      publish_revision: Number(post.publish_revision || 0),
      publish_lease_owner: post.publish_lease_owner || '',
      publish_lease_expires_at: post.publish_lease_expires_at || '',
    },
    patch: withPublishQueueProjection(post, {
      published_at: '',
      stats: {
        ...stats,
        status: 'cancelled',
        calendarHidden: true,
        cancelledAt: now,
        cancelledBy: userId,
        nextPublishAttemptAt: '',
        publishError: '',
        warnings: [],
      },
      publish_revision: Number(post.publish_revision || 0) + 1,
      publish_lease_owner: '',
      publish_lease_expires_at: '',
    }),
  });
  if (!cancelled.ok) {
    res.status(409).json({ error: 'calendar_post_cancel_conflict' });
    return;
  }
  await releasePostContentFences(store, post.id).catch(error => {
    throw Object.assign(new Error('calendar_content_fence_release_failed'), { cause: error });
  });
  await writeAuditLog({
    tenantId,
    actorUserId: userId,
    action: 'publishing.calendar_cancelled',
    targetType: 'post',
    targetId: post.id,
    metadata: { publishRevision: Number(cancelled.record.publish_revision || 0) },
  });
  res.status(204).end();
});

publishingRouter.patch('/calendar/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const post = await store.getById<PostRecord>('posts', String(req.params.id));
  if (!post || post.tenant_id !== tenantId) {
    res.status(404).json({ error: 'post_not_found' });
    return;
  }
  if (requireExpectedRevision(req, res, post) === null) return;
  const currentStats = parseJson<Record<string, unknown>>(post.stats, {});
  if (post.reconciliation_required === true || text(currentStats.status) === 'needs_reconciliation') {
    res.status(409).json({
      error: 'publishing_reconciliation_required_before_edit',
      message: '平台结果不确定，必须先按账号完成发布对账，不能通过编辑重新排期。',
    });
    return;
  }
  if (hasPublishedTargets(post)) {
    res.status(409).json({ error: 'published_post_cannot_be_rescheduled' });
    return;
  }
  if (isPublishingPost(post)) {
    res.status(409).json({ error: 'publishing_post_cannot_be_rescheduled' });
    return;
  }
  if (currentStats.source === 'digital_employee') {
    res.status(409).json({ error: 'digital_employee_schedule_requires_new_approval' });
    return;
  }
  if (currentStats.directPublish === true) {
    res.status(409).json({ error: 'direct_publish_post_cannot_be_rescheduled' });
    return;
  }
  const update: Record<string, unknown> = {};
  const stats = { ...currentStats };
  let changed = false;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'scheduledAt')) {
    if (currentStats.scheduleLocked === true && req.body?.overrideScheduleLock !== true) {
      res.status(409).json({ error: '定点排期时间已锁定，请先取消原排期再重新设置。' });
      return;
    }
    const scheduledAt = text(req.body?.scheduledAt);
    if (!scheduledAt || !Number.isFinite(Date.parse(scheduledAt))) {
      res.status(400).json({ error: 'valid_scheduled_at_required' });
      return;
    }
    update.published_at = scheduledAt;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'title')) {
    const title = text(req.body?.title);
    if (!title) {
      res.status(400).json({ error: 'title_required' });
      return;
    }
    update.title = title;
    changed = true;
  }
  for (const field of ['description', 'firstComment', 'coverUrl'] as const) {
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, field)) continue;
    stats[field] = text(req.body?.[field]);
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'videoPath')) {
    const requestedVideoPath = text(req.body?.videoPath);
    const videoPath = requestedVideoPath ? resolveTenantPublishingVideo(tenantId, requestedVideoPath) || '' : '';
    if (requestedVideoPath && !videoPath) {
      res.status(400).json({ error: 'video_path_outside_tenant_storage' });
      return;
    }
    stats.videoPath = videoPath;
    changed = true;
  }
  for (const field of ['targetAccountIds', 'targetAccountLabels'] as const) {
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, field)) continue;
    stats[field] = Array.isArray(req.body?.[field])
      ? req.body[field].map(String).map(text).filter(Boolean)
      : [];
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'trackWaLink')) {
    stats.trackWaLink = req.body?.trackWaLink !== false;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'tiktokPublishOptionsByAccount')) {
    stats.tiktokPublishOptionsByAccount = req.body?.tiktokPublishOptionsByAccount;
    changed = true;
  }
  if (!changed) {
    res.status(400).json({ error: 'calendar_update_required' });
    return;
  }
  const finalVideoPath = text(stats.videoPath);
  const finalVideoUrl = finalVideoPath ? '' : text(stats.videoUrl);
  const videoIdentity = finalVideoPath ? await tenantPublishingVideoSha256(tenantId, finalVideoPath) : null;
  if (!videoIdentity) {
    res.status(400).json({ error: 'immutable_local_video_required' });
    return;
  }
  const videoSha256 = videoIdentity?.sha256 || '';
  const contentDigest = scheduleContentDigest(videoSha256, finalVideoUrl);
  if (!contentDigest) {
    res.status(400).json({ error: 'publishing_content_digest_required' });
    return;
  }
  const targetAccountIds = Array.isArray(stats.targetAccountIds)
    ? Array.from(new Set(stats.targetAccountIds.map(String).map(text).filter(Boolean)))
    : [];
  const targetAccountLabels = Array.isArray(stats.targetAccountLabels)
    ? stats.targetAccountLabels.map(String).map(text).filter(Boolean)
    : [];
  if (!targetAccountIds.length) {
    res.status(400).json({ error: 'target_account_required' });
    return;
  }
  if (targetAccountIds.length > MAX_CALENDAR_TARGET_ACCOUNTS) {
    res.status(400).json({ error: 'target_account_limit_exceeded', limit: MAX_CALENDAR_TARGET_ACCOUNTS });
    return;
  }
  if (!await validateTargetAccountBindings(tenantId, post.platform, targetAccountIds)) {
    res.status(400).json({ error: 'target_accounts_do_not_match_tenant_platform' });
    return;
  }
  try {
    const tiktokPublishOptionsByAccount = validateScheduledTikTokPublishOptions({
      platform: post.platform,
      targetAccountIds,
      value: stats.tiktokPublishOptionsByAccount,
    });
    if (post.platform === 'tiktok') stats.tiktokPublishOptionsByAccount = tiktokPublishOptionsByAccount;
    else delete stats.tiktokPublishOptionsByAccount;
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'tiktok_publish_options_invalid' });
    return;
  }
  const ownerKey = text(post.digital_employee_idempotency_key) || `calendar-post:${post.id}`;
  let reservation;
  try {
    reservation = await reservePublishContentFences({
      dataStore: store,
      tenantId,
      platform: post.platform,
      accountIds: targetAccountIds,
      contentDigest,
      ownerKey,
    });
  } catch (error) {
    if (error instanceof PublishContentFenceError) {
      res.status(409).json({ error: error.code, conflictingPostId: error.postId });
      return;
    }
    throw error;
  }
  stats.videoPath = videoIdentity?.filePath || finalVideoPath;
  stats.videoUrl = finalVideoUrl;
  stats.videoSha256 = videoSha256;
  stats.publishContentDigest = contentDigest;
  stats.publishContentFenceKeys = reservation.records.map(record => record.fence_key).sort();
  stats.targetAccountIds = targetAccountIds;
  stats.targetAccountLabels = targetAccountLabels;
  stats.status = 'scheduled';
  stats.publishAttempts = 0;
  stats.publishResults = {};
  stats.publishError = '';
  stats.nextPublishAttemptAt = '';
  stats.warnings = [];
  stats.scheduleRevision = Number(currentStats.scheduleRevision || 1) + 1;
  const scheduledAt = text(update.published_at || post.published_at);
  const finalTitle = text(update.title || post.title) || 'Untitled content';
  stats.schedulePayloadHash = schedulePayloadHash({
    tenantId,
    contentId: text(post.content_id),
    platform: post.platform,
    title: finalTitle,
    scheduledAt,
    language: text(stats.language),
    coverUrl: text(stats.coverUrl),
    description: text(stats.description),
    firstComment: text(stats.firstComment),
    videoPath: text(stats.videoPath),
    videoUrl: finalVideoUrl,
    videoSha256,
    publishContentDigest: contentDigest,
    contentFenceKeys: stats.publishContentFenceKeys as string[],
    ...(post.platform === 'tiktok' ? {
      tiktokPublishOptionsByAccount: stats.tiktokPublishOptionsByAccount as SchedulePostInput['tiktokPublishOptionsByAccount'],
    } : {}),
    targetAccountIds,
    targetAccountLabels,
    trackWaLink: stats.trackWaLink !== false,
    scheduleLocked: stats.scheduleLocked === true,
    source: 'manual',
  });
  update.stats = stats;
  update.publish_revision = Number(post.publish_revision || 0) + 1;
  try {
    // Link the new-content fences while the old revision is still the only
    // executable payload. The following CAS is therefore the activation point.
    await attachPublishContentFences(store, reservation.records, ownerKey, post.id);
  } catch (error) {
    await cleanupMutationContentFences(
      post.id,
      reservation.records.map(record => record.fence_key),
      true,
    ).catch(() => undefined);
    await releasePublishContentReservations(store, reservation.createdIds, ownerKey).catch(() => undefined);
    throw error;
  }
  const persisted = await compareAndSetRecord<PostRecord>({
    store,
    collection: 'posts',
    id: post.id,
    expected: {
      publish_revision: Number(post.publish_revision || 0),
      publish_lease_owner: post.publish_lease_owner || '',
      publish_lease_expires_at: post.publish_lease_expires_at || '',
      digital_employee_fence_revision: Number(post.digital_employee_fence_revision || 0),
      reconciliation_required: false,
    },
    patch: withPublishQueueProjection(post, update),
  });
  if (!persisted.ok) {
    await cleanupMutationContentFences(
      post.id,
      reservation.records.map(record => record.fence_key),
      true,
    ).catch(() => undefined);
    await releasePublishContentReservations(store, reservation.createdIds, ownerKey).catch(() => undefined);
    res.status(409).json({ error: 'calendar_post_update_conflict' });
    return;
  }
  try {
    await releasePostContentFences(store, post.id, reservation.records.map(record => record.fence_key));
  } catch (error) {
    // The new payload is fenced; retaining obsolete extra fences is safe and
    // operationally visible, whereas rolling the post back would race workers.
    throw error;
  }
  res.json({ item: publicPost(persisted.record) });
});

publishingRouter.post('/adapt-copy', async (req, res) => {
  const title = text(req.body?.title);
  const description = text(req.body?.description);
  const language = text(req.body?.language) || 'English';
  const requestedPlatforms = sanitizePublishCopyPlatforms(req.body?.platforms);
  const single = sanitizePublishCopyPlatforms([req.body?.platform])[0];
  const targetPlatforms = single
    ? [single]
    : requestedPlatforms.length ? requestedPlatforms : [...PUBLISH_COPY_PLATFORMS];
  const mode = text(req.body?.mode) === 'regenerate' ? 'regenerate' : 'generate';
  const rawCurrentCopy = req.body?.currentCopy && typeof req.body.currentCopy === 'object' && !Array.isArray(req.body.currentCopy)
    ? req.body.currentCopy as Record<string, PlatformCopy>
    : {};
  const currentCopy = Object.fromEntries(
    targetPlatforms
      .filter(platform => rawCurrentCopy[platform] && typeof rawCurrentCopy[platform] === 'object')
      .map(platform => [platform, rawCurrentCopy[platform]]),
  ) as Partial<Record<PublishCopyPlatform, PlatformCopy>>;
  const requireAlternative = mode === 'regenerate';

  if (!title && !description) {
    res.status(400).json({ error: 'copy_source_required', message: '请先填写作品标题或发布配文' });
    return;
  }

  const prompt = [
    'Generate platform-native publishing copy as strict JSON only.',
    `Target language: ${language}`,
    `Title: ${title}`,
    `Draft copy: ${description}`,
    `Requested platforms: ${targetPlatforms.join(', ')}`,
    'Only return the requested platform keys.',
    'youtube: { title <=70 chars, description, tags[], firstComment }',
    'tiktok: { caption <=120 chars, hashtags[], firstComment }',
    'instagram: { caption, hashtags[], firstComment }',
    'facebook: { text, hashtags[], firstComment }',
    'Make every platform different. Put hashtags and wa.me link friendly text in firstComment when useful.',
    'Use only facts present in the title and draft copy. Do not invent features, specifications, certifications, prices, inventory, customer results, or delivery promises.',
    requireAlternative
      ? `Create a materially different alternative from this current version while preserving facts: ${JSON.stringify(currentCopy)}`
      : '',
  ].join('\n');
  try {
    const raw = await callLLM(prompt);
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);
    res.json({
      copy: normalizePlatformCopies(parsed, targetPlatforms, title, description, { currentCopy, requireAlternative }),
      source: 'ai',
    });
  } catch {
    res.json({
      copy: normalizePlatformCopies({}, targetPlatforms, title, description, { currentCopy, requireAlternative }),
      source: 'fallback',
    });
  }
});

publishingRouter.post('/queue/suggestions/regenerate', async (req, res) => {
  const platform = text(req.body?.platform) || 'tiktok';
  const market = text(req.body?.market) || '综合市场';
  const scheduledAt = text(req.body?.scheduledAt);
  const festival = text(req.body?.festival);
  const feedback = text(req.body?.feedback);
  const currentTitle = text(req.body?.currentTitle);
  const fallback = fallbackQueueSuggestion({ currentTitle, feedback, festival });
  const prompt = [
    '你是 B2B 外贸社媒内容排产助手。请只返回严格 JSON。',
    `平台：${platform}`,
    `目标市场：${market}`,
    `建议发布时间：${scheduledAt}`,
    festival ? `关联节庆：${festival}` : '',
    currentTitle ? `当前选题：${currentTitle}` : '',
    feedback ? `老板修改意见：${feedback}` : '',
    '输出字段：title（20字以内）、brief（60字以内）、tags（2个短标签）。',
    '不得虚构企业产品参数、认证、价格、库存、客户案例或优惠；缺失事实用内容结构表达。',
    '选题要适合短视频并自然引导采购商询盘。',
  ].filter(Boolean).join('\n');
  try {
    const raw = await callLLM(prompt);
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);
    res.json({
      suggestion: {
        title: text(parsed?.title) || fallback.title,
        brief: text(parsed?.brief) || fallback.brief,
        tags: Array.isArray(parsed?.tags) ? parsed.tags.map(String).map(text).filter(Boolean).slice(0, 3) : fallback.tags,
      },
    });
  } catch {
    res.json({ suggestion: fallback });
  }
});

publishingRouter.get('/posts/effects', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const result = await store.list<PostRecord>('posts', { where: { tenant_id: tenantId }, perPage: 200, sort: '-published_at' });
  const items = result.items.map(publicPost)
    .sort((a, b) => b.inquiries - a.inquiries || Date.parse(b.publishedAt || '') - Date.parse(a.publishedAt || ''));
  const cutoff = Date.now() - 30 * 86_400_000;
  const recent = items.filter(item => {
    const time = Date.parse(item.publishedAt || '');
    return Number.isFinite(time) && time >= cutoff;
  });
  res.json({
    items,
    summary: {
      posts30d: recent.length,
      inquiries30d: recent.reduce((sum, item) => sum + item.inquiries, 0),
      deals30d: recent.reduce((sum, item) => sum + item.deals, 0),
    },
  });
});

publishingRouter.get('/briefing', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const result = await store.list<PostRecord>('posts', { where: { tenant_id: tenantId }, perPage: 50, sort: '-updated' });
  const top = result.items
    .map(publicPost)
    .filter(item => item.inquiries > 0)
    .sort((a, b) => b.inquiries - a.inquiries)[0];
  res.json({ item: top || null });
});

publishingRouter.get('/recycle-lists', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const result = await store.list<RecycleListRecord>('recycle_lists', { where: { tenant_id: tenantId }, perPage: 100, sort: '-updated' });
  res.json({ items: result.items });
});

publishingRouter.post('/recycle-lists', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const created = await store.create<RecycleListRecord>('recycle_lists', {
    tenant_id: tenantId,
    name: text(req.body?.name) || 'Recycle list',
    enabled: Boolean(req.body?.enabled),
    items: Array.isArray(req.body?.items) ? req.body.items.slice(0, 60) : [],
    slots: Array.isArray(req.body?.slots) ? req.body.slots : [],
    refresh_mode: text(req.body?.refreshMode || req.body?.refresh_mode) || 'copy',
    cursor: Number(req.body?.cursor || 0) || 0,
  });
  res.status(201).json({ item: created });
});

publishingRouter.patch('/recycle-lists/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const existing = await store.getById<RecycleListRecord>('recycle_lists', String(req.params.id));
  if (!existing || existing.tenant_id !== tenantId) {
    res.status(404).json({ error: 'recycle_list_not_found' });
    return;
  }
  const patch: Record<string, unknown> = {};
  if (req.body?.name !== undefined) patch.name = text(req.body.name);
  if (req.body?.enabled !== undefined) patch.enabled = Boolean(req.body.enabled);
  if (req.body?.items !== undefined) patch.items = Array.isArray(req.body.items) ? req.body.items.slice(0, 60) : [];
  if (req.body?.slots !== undefined) patch.slots = Array.isArray(req.body.slots) ? req.body.slots : [];
  if (req.body?.refreshMode !== undefined || req.body?.refresh_mode !== undefined) patch.refresh_mode = text(req.body.refreshMode || req.body.refresh_mode);
  if (req.body?.cursor !== undefined) patch.cursor = Number(req.body.cursor || 0) || 0;
  await store.update('recycle_lists', existing.id, patch);
  const item = await store.getById<RecycleListRecord>('recycle_lists', existing.id);
  res.json({ item });
});
