import FormData from 'form-data';
import fs from 'node:fs';
import path from 'node:path';
import { providerHttp as axios } from '../security/providerHttp.js';

const TIKTOK_API = 'https://open.tiktokapis.com';
const META_GRAPH = 'https://graph.facebook.com';
const META_GRAPH_VIDEO = 'https://graph-video.facebook.com';

export type SocialPlatform = 'tiktok' | 'instagram' | 'facebook';

export type TikTokPrivacyLevel =
  | 'PUBLIC_TO_EVERYONE'
  | 'MUTUAL_FOLLOW_FRIENDS'
  | 'FOLLOWER_OF_CREATOR'
  | 'SELF_ONLY';

export type TikTokCreatorInfo = {
  username: string;
  nickname: string;
  avatarUrl: string;
  privacyLevelOptions: TikTokPrivacyLevel[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number;
};

export type TikTokPublishOptions = {
  privacyLevel: TikTokPrivacyLevel;
  allowComment: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  brandContentToggle: boolean;
  brandOrganicToggle: boolean;
  isAigc: boolean;
  userConsent: boolean;
};

export interface SocialUploadInput {
  filePath?: string;
  videoUrl?: string;
  title: string;
  description?: string;
  privacyStatus?: 'private' | 'unlisted' | 'public';
  tiktokPublishOptions?: TikTokPublishOptions;
  videoDurationSeconds?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  onProviderOperationId?: (providerOperationId: string) => void | Promise<void>;
}

export interface SocialUploadResult {
  id: string;
  title: string;
  privacyStatus: string;
  url: string;
  /** Provider-side operation handle retained for reconciliation/audit. */
  providerOperationId?: string;
}

export type TikTokPublishStatus =
  | 'PROCESSING_UPLOAD'
  | 'PROCESSING_DOWNLOAD'
  | 'SEND_TO_USER_INBOX'
  | 'PUBLISH_COMPLETE'
  | 'FAILED';

export interface TikTokPublishStatusResult {
  status: TikTokPublishStatus | string;
  failReason: string;
  publicPostIds: string[];
}

export type TikTokStatusPollDependencies = {
  fetchStatus?: (accessToken: string, publishId: string, input: Pick<SocialUploadInput, 'signal' | 'timeoutMs'>) => Promise<unknown>;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  pollIntervalMs?: number;
};

export function asTikTokPreflightFailure(error: unknown): Error {
  const base = error instanceof Error && Object.isExtensible(error)
    ? error
    : Object.assign(new Error(error instanceof Error ? error.message : String(error)), { cause: error });
  const candidate = error && typeof error === 'object'
    ? error as { statusCode?: unknown; response?: { status?: unknown } }
    : {};
  const rawStatus = Number(candidate.response?.status ?? candidate.statusCode);
  const statusCode = Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599 ? rawStatus : null;
  return Object.assign(base, {
    ...(statusCode !== null ? { statusCode } : {}),
    publishFailureClassification: {
      disposition: 'definitive_rejection',
      outcomeUnknown: false,
      retrySafe: true,
      statusCode,
      reason: 'provider_preflight',
    },
  });
}

export interface TikTokTokens {
  accessToken: string;
  refreshToken: string;
  openId: string;
  scope?: string;
  expiresIn?: number;
  refreshExpiresIn?: number;
}

export interface TikTokUser {
  openId: string;
  displayName: string;
  avatarUrl?: string;
  profileUrl?: string;
  followerCount?: number;
  videoCount?: number;
  likeCount?: number;
}

export interface MetaPage {
  id: string;
  name: string;
  accessToken: string;
  pictureUrl?: string;
  fanCount?: number;
  instagram?: {
    id: string;
    username: string;
    profilePictureUrl?: string;
    followersCount?: number;
    mediaCount?: number;
  };
}

export interface MetaInstagramAccount {
  id: string;
  username: string;
  profilePictureUrl?: string;
  followersCount?: number;
  mediaCount?: number;
}

function mimeType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.webm') return 'video/webm';
  return 'video/mp4';
}

function requireFile(filePath?: string) {
  if (!filePath) throw new Error('缺少视频文件路径');
  if (!fs.existsSync(filePath)) throw new Error('成片文件不存在，请先重新合成');
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error('成片路径不是文件');
  return stat;
}

const TIKTOK_PRIVACY_LEVELS = new Set<TikTokPrivacyLevel>([
  'PUBLIC_TO_EVERYONE',
  'MUTUAL_FOLLOW_FRIENDS',
  'FOLLOWER_OF_CREATOR',
  'SELF_ONLY',
]);

export function tiktokDirectPostAudited(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.TIKTOK_DIRECT_POST_AUDITED || '').trim().toLowerCase() === 'true';
}

function tiktokPreflightError(message: string, code: string): Error {
  return Object.assign(new Error(message), {
    code,
    statusCode: 422,
    publishFailureClassification: {
      disposition: 'definitive_rejection',
      outcomeUnknown: false,
      retrySafe: true,
      statusCode: 422,
      reason: 'local_rejection',
    },
  });
}

export async function queryTikTokCreatorInfo(
  accessToken: string,
  input: Pick<SocialUploadInput, 'signal' | 'timeoutMs'> = {},
): Promise<TikTokCreatorInfo> {
  const response = await axios.post(
    `${TIKTOK_API}/v2/post/publish/creator_info/query/`,
    null,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      signal: input.signal,
      timeout: Math.max(1_000, Number(input.timeoutMs || 30_000)),
    },
  );
  const apiError = response.data?.error;
  const errorCode = String(apiError?.code || '').trim();
  if (errorCode && errorCode.toLowerCase() !== 'ok') {
    throw tiktokPreflightError(String(apiError?.message || errorCode), errorCode);
  }
  const data = response.data?.data;
  const privacyLevelOptions = Array.isArray(data?.privacy_level_options)
    ? data.privacy_level_options.map(String).filter((value: string): value is TikTokPrivacyLevel => TIKTOK_PRIVACY_LEVELS.has(value as TikTokPrivacyLevel))
    : [];
  const maxVideoPostDurationSec = Number(data?.max_video_post_duration_sec || 0);
  if (!data || !String(data.creator_nickname || '').trim() || !privacyLevelOptions.length
    || !Number.isFinite(maxVideoPostDurationSec) || maxVideoPostDurationSec <= 0) {
    throw tiktokPreflightError('TikTok 未返回完整的创作者发布权限', 'tiktok_creator_info_incomplete');
  }
  return {
    username: String(data.creator_username || ''),
    nickname: String(data.creator_nickname || ''),
    avatarUrl: String(data.creator_avatar_url || ''),
    privacyLevelOptions,
    commentDisabled: data.comment_disabled === true,
    duetDisabled: data.duet_disabled === true,
    stitchDisabled: data.stitch_disabled === true,
    maxVideoPostDurationSec,
  };
}

function validateTikTokPublishOptions(
  options: TikTokPublishOptions | undefined,
  creator: TikTokCreatorInfo,
  durationSeconds: number | undefined,
): TikTokPublishOptions {
  if (!options || options.userConsent !== true) {
    throw tiktokPreflightError('发布前必须明确同意 TikTok 音乐使用确认', 'tiktok_user_consent_required');
  }
  if (!TIKTOK_PRIVACY_LEVELS.has(options.privacyLevel)
    || !creator.privacyLevelOptions.includes(options.privacyLevel)) {
    throw tiktokPreflightError('所选 TikTok 可见范围不再可用，请刷新创作者信息后重选', 'tiktok_privacy_level_invalid');
  }
  if (!tiktokDirectPostAudited() && options.privacyLevel !== 'SELF_ONLY') {
    throw tiktokPreflightError('当前 TikTok API 客户端尚未通过审核，只能选择“仅自己可见”', 'tiktok_unaudited_self_only_required');
  }
  if ((creator.commentDisabled && options.allowComment)
    || (creator.duetDisabled && options.allowDuet)
    || (creator.stitchDisabled && options.allowStitch)) {
    throw tiktokPreflightError('创作者账号已关闭所选互动能力，请刷新后重选', 'tiktok_interaction_not_available');
  }
  if (options.brandContentToggle && options.privacyLevel === 'SELF_ONLY') {
    throw tiktokPreflightError('品牌合作内容不能设为仅自己可见', 'tiktok_branded_content_private_invalid');
  }
  if (Number.isFinite(durationSeconds) && Number(durationSeconds) > creator.maxVideoPostDurationSec + 0.05) {
    throw tiktokPreflightError(
      `视频时长超过该 TikTok 创作者允许的 ${creator.maxVideoPostDurationSec} 秒`,
      'tiktok_video_duration_exceeded',
    );
  }
  return options;
}

export function tikTokUploadPlan(videoSize: number): { chunkSize: number; totalChunkCount: number } {
  if (!Number.isSafeInteger(videoSize) || videoSize <= 0) throw new Error('tiktok_video_size_invalid');
  const maxChunk = 64 * 1024 * 1024;
  if (videoSize <= maxChunk) return { chunkSize: videoSize, totalChunkCount: 1 };
  // TikTok defines total_chunk_count as floor(video_size / chunk_size), with
  // the final request carrying the remainder and allowed to reach 128 MiB.
  const chunkSize = videoSize < 2 * maxChunk ? 32 * 1024 * 1024 : maxChunk;
  const totalChunkCount = Math.floor(videoSize / chunkSize);
  if (totalChunkCount < 2 || totalChunkCount > 1_000) throw new Error('tiktok_chunk_count_invalid');
  return { chunkSize, totalChunkCount };
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason || Object.assign(new Error('upload_aborted'), { code: 'ERR_CANCELED' })); return; }
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal?.reason || Object.assign(new Error('upload_aborted'), { code: 'ERR_CANCELED' }));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function tikTokUnknownOutcomeError(message: string, publishId: string, cause?: unknown): Error {
  return Object.assign(new Error(message), {
    ...(cause === undefined ? {} : { cause }),
    code: 'TIKTOK_PUBLISH_OUTCOME_UNKNOWN',
    statusCode: 504,
    providerOperationId: publishId,
    publishFailureClassification: {
      disposition: 'outcome_unknown',
      outcomeUnknown: true,
      retrySafe: false,
      statusCode: 504,
      reason: 'network_or_timeout',
    },
  });
}

function attachTikTokUnknownOutcome(error: unknown, publishId: string, message: string): Error {
  if (error instanceof Error && Object.isExtensible(error)) {
    return Object.assign(error, {
      providerOperationId: publishId,
      publishFailureClassification: {
        disposition: 'outcome_unknown',
        outcomeUnknown: true,
        retrySafe: false,
        statusCode: Number((error as { statusCode?: unknown }).statusCode || 504) || 504,
        reason: 'network_or_timeout',
      },
    });
  }
  return tikTokUnknownOutcomeError(message, publishId, error);
}

function tikTokDefinitiveFailureError(message: string, publishId: string): Error {
  return Object.assign(new Error(message), {
    code: 'TIKTOK_PUBLISH_FAILED',
    statusCode: 422,
    providerOperationId: publishId,
    publishFailureClassification: {
      disposition: 'definitive_rejection',
      outcomeUnknown: false,
      retrySafe: true,
      statusCode: 422,
      reason: 'definitive_http_4xx',
    },
  });
}

export function normalizeTikTokPublishStatus(response: unknown): TikTokPublishStatusResult {
  const envelope = response && typeof response === 'object' && !Array.isArray(response)
    ? response as Record<string, any>
    : {};
  const apiError = envelope.error && typeof envelope.error === 'object' ? envelope.error : {};
  const errorCode = String(apiError.code || '').trim();
  if (errorCode && errorCode.toLowerCase() !== 'ok') {
    throw Object.assign(new Error(String(apiError.message || errorCode || 'TikTok 状态查询失败')), {
      statusCode: 502,
      code: errorCode,
    });
  }
  const data = envelope.data && typeof envelope.data === 'object' ? envelope.data : {};
  const rawIds = Array.isArray(data.publicaly_available_post_id)
    ? data.publicaly_available_post_id
    : Array.isArray(data.publicly_available_post_id)
      ? data.publicly_available_post_id
      : [];
  return {
    status: String(data.status || '').trim(),
    failReason: String(data.fail_reason || '').trim(),
    publicPostIds: rawIds.map(String).map((value: string) => value.trim()).filter(Boolean),
  };
}

async function fetchTikTokPublishStatus(
  accessToken: string,
  publishId: string,
  input: Pick<SocialUploadInput, 'signal' | 'timeoutMs'>,
): Promise<unknown> {
  const response = await axios.post(
    `${TIKTOK_API}/v2/post/publish/status/fetch/`,
    { publish_id: publishId },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      signal: input.signal,
      timeout: Math.max(1_000, Number(input.timeoutMs || 10 * 60_000)),
    },
  );
  return response.data;
}

/**
 * TikTok's upload PUT only transfers bytes; it does not prove a post exists.
 * Keep the publish_id as a reconciliation handle and return only after the
 * status endpoint exposes a real public post id.
 */
export async function waitForTikTokPublishComplete(input: {
  accessToken: string;
  publishId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  deadlineMs?: number;
  /** TikTok exposes a post_id only after public moderation. */
  publicPostIdRequired?: boolean;
}, dependencies: TikTokStatusPollDependencies = {}): Promise<string> {
  const now = dependencies.now ?? Date.now;
  const timeoutMs = Math.max(1_000, Number(input.timeoutMs || 10 * 60_000));
  const deadlineMs = Number.isFinite(input.deadlineMs) ? Number(input.deadlineMs) : now() + timeoutMs;
  // TikTok documents a 30 requests/minute status-query cap per publish id.
  const pollIntervalMs = Math.max(2_000, Number(dependencies.pollIntervalMs || 3_000));
  const fetchStatus = dependencies.fetchStatus ?? fetchTikTokPublishStatus;
  const sleep = dependencies.sleep ?? delay;
  let lastStatus = '';
  for (;;) {
    if (input.signal?.aborted) {
      throw attachTikTokUnknownOutcome(input.signal.reason, input.publishId, 'TikTok 发布状态查询已中止');
    }
    const remaining = deadlineMs - now();
    if (remaining <= 0) {
      throw tikTokUnknownOutcomeError(
        `TikTok 在截止时间前未返回确定发布结果（最后状态：${lastStatus || '未知'}）`,
        input.publishId,
      );
    }
    let normalized: TikTokPublishStatusResult;
    try {
      const response = await fetchStatus(input.accessToken, input.publishId, {
        signal: input.signal,
        timeoutMs: Math.max(1_000, remaining),
      });
      normalized = normalizeTikTokPublishStatus(response);
    } catch (error) {
      if (input.signal?.aborted) {
        throw attachTikTokUnknownOutcome(input.signal.reason || error, input.publishId, 'TikTok 发布状态查询已中止');
      }
      throw tikTokUnknownOutcomeError('TikTok 状态查询失败，平台结果不确定', input.publishId, error);
    }
    lastStatus = normalized.status;
    if (normalized.status === 'FAILED') {
      throw tikTokDefinitiveFailureError(
        `TikTok 发布失败：${normalized.failReason || '平台未提供原因'}`,
        input.publishId,
      );
    }
    if (normalized.status === 'PUBLISH_COMPLETE') {
      if (normalized.publicPostIds[0]) return normalized.publicPostIds[0];
      if (input.publicPostIdRequired === false) return `tiktok-publish:${input.publishId}`;
    }
    if (!['PROCESSING_UPLOAD', 'PROCESSING_DOWNLOAD', 'PUBLISH_COMPLETE'].includes(normalized.status)) {
      throw tikTokUnknownOutcomeError(
        `TikTok 返回未预期发布状态：${normalized.status || '空'}`,
        input.publishId,
      );
    }
    await sleep(Math.min(pollIntervalMs, Math.max(1, deadlineMs - now())), input.signal);
  }
}

export async function exchangeTikTokCode(input: {
  clientKey: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<TikTokTokens> {
  const params = new URLSearchParams({
    client_key: input.clientKey,
    client_secret: input.clientSecret,
    code: input.code,
    grant_type: 'authorization_code',
    redirect_uri: input.redirectUri,
  });

  const res = await axios.post(`${TIKTOK_API}/v2/oauth/token/`, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return {
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token,
    openId: res.data.open_id,
    scope: res.data.scope,
    expiresIn: res.data.expires_in,
    refreshExpiresIn: res.data.refresh_expires_in,
  };
}

export async function getTikTokUser(accessToken: string): Promise<TikTokUser> {
  const fields = [
    'open_id',
    'display_name',
    'avatar_url',
    'profile_deep_link',
    'follower_count',
    'video_count',
    'likes_count',
  ].join(',');
  const res = await axios.get(`${TIKTOK_API}/v2/user/info/`, {
    params: { fields },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const user = res.data?.data?.user;
  if (!user?.open_id) throw new Error('TikTok 未返回账号信息');
  return {
    openId: user.open_id,
    displayName: user.display_name || 'TikTok',
    avatarUrl: user.avatar_url,
    profileUrl: user.profile_deep_link,
    followerCount: Number(user.follower_count || 0),
    videoCount: Number(user.video_count || 0),
    likeCount: Number(user.likes_count || 0),
  };
}

export async function getTikTokVideos(accessToken: string, maxResults = 20) {
  const fields = [
    'id',
    'title',
    'cover_image_url',
    'share_url',
    'video_description',
    'duration',
    'create_time',
    'view_count',
    'like_count',
    'comment_count',
    'share_count',
  ].join(',');
  const res = await axios.post(
    `${TIKTOK_API}/v2/video/list/`,
    { max_count: Math.min(20, maxResults) },
    {
      params: { fields },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
    },
  );
  return (res.data?.data?.videos ?? []).map((v: any) => ({
    id: String(v.id),
    title: String(v.title || v.video_description || 'TikTok video'),
    description: String(v.video_description || ''),
    publishedAt: v.create_time ? new Date(Number(v.create_time) * 1000).toISOString() : '',
    thumbnailUrl: String(v.cover_image_url || ''),
    viewCount: Number(v.view_count || 0),
    likeCount: Number(v.like_count || 0),
    commentCount: Number(v.comment_count || 0),
    shareCount: Number(v.share_count || 0),
    duration: String(v.duration || ''),
    permalinkUrl: String(v.share_url || ''),
  }));
}

export interface PlatformInsightPoint {
  metric: string;
  period: string;
  value: number | Record<string, unknown>;
  endTime?: string;
}

function normalizeMetaInsights(data: any): PlatformInsightPoint[] {
  return (data?.data ?? []).flatMap((metric: any) =>
    (metric.values ?? [{ value: metric.total_value?.value ?? metric.value }]).map((point: any) => ({
      metric: String(metric.name || metric.id || ''),
      period: String(metric.period || 'lifetime'),
      value: typeof point?.value === 'number' ? point.value : (point?.value ?? {}),
      ...(point?.end_time ? { endTime: String(point.end_time) } : {}),
    })),
  ).filter((point: PlatformInsightPoint) => point.metric);
}

/** Page-level metrics for a Facebook Page owned by the authorized user. */
export async function getFacebookPageInsights(
  pageId: string,
  pageAccessToken: string,
  graphVersion: string,
  input: { since: string; until: string },
) {
  const res = await axios.get(`${META_GRAPH}/${graphVersion}/${pageId}/insights`, {
    params: {
      access_token: pageAccessToken,
      metric: [
        'page_impressions_unique',
        'page_post_engagements',
        'page_video_views',
        'page_video_view_time',
      ].join(','),
      period: 'day',
      since: input.since,
      until: input.until,
    },
  });
  return normalizeMetaInsights(res.data);
}

/** Account-level metrics for an Instagram professional account. */
export async function getInstagramAccountInsights(
  igUserId: string,
  pageAccessToken: string,
  graphVersion: string,
  input: { since: string; until: string },
) {
  const res = await axios.get(`${META_GRAPH}/${graphVersion}/${igUserId}/insights`, {
    params: {
      access_token: pageAccessToken,
      metric: 'reach,follower_count,profile_views,accounts_engaged,total_interactions,likes,comments,shares,saves',
      period: 'day',
      metric_type: 'total_value',
      since: input.since,
      until: input.until,
    },
  });
  return normalizeMetaInsights(res.data);
}

export async function uploadTikTokVideo(
  accessToken: string,
  input: SocialUploadInput,
  dependencies: TikTokStatusPollDependencies = {},
): Promise<SocialUploadResult> {
  const timeoutMs = Math.max(1_000, Number(input.timeoutMs || 10 * 60_000));
  const deadlineMs = Date.now() + timeoutMs;
  let stat: fs.Stats;
  let creator: TikTokCreatorInfo;
  let publishOptions: TikTokPublishOptions;
  let uploadPlan: ReturnType<typeof tikTokUploadPlan>;
  try {
    stat = requireFile(input.filePath);
    creator = await queryTikTokCreatorInfo(accessToken, input);
    publishOptions = validateTikTokPublishOptions(input.tiktokPublishOptions, creator, input.videoDurationSeconds);
    uploadPlan = tikTokUploadPlan(stat.size);
  } catch (error) {
    // Creator-info and all local validation happen before TikTok allocates a
    // publish id. Their failures are retry-safe and must not create a false
    // outcome-unknown reconciliation task.
    throw asTikTokPreflightFailure(error);
  }
  const title = (input.title || input.description || 'Untitled video').slice(0, 2_200);
  const init = await axios.post(
    `${TIKTOK_API}/v2/post/publish/video/init/`,
    {
      post_info: {
        title,
        privacy_level: publishOptions.privacyLevel,
        disable_duet: !publishOptions.allowDuet,
        disable_comment: !publishOptions.allowComment,
        disable_stitch: !publishOptions.allowStitch,
        brand_content_toggle: publishOptions.brandContentToggle,
        brand_organic_toggle: publishOptions.brandOrganicToggle,
        is_aigc: publishOptions.isAigc,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: stat.size,
        chunk_size: uploadPlan.chunkSize,
        total_chunk_count: uploadPlan.totalChunkCount,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      signal: input.signal,
      timeout: timeoutMs,
    },
  );
  const uploadUrl = init.data?.data?.upload_url;
  const publishId = init.data?.data?.publish_id;
  if (!uploadUrl || !publishId) throw new Error('TikTok 未返回上传地址');
  // Persist the provider handle before sending any video bytes. A process
  // crash after this point must still leave enough evidence for exact status
  // reconciliation instead of an anonymous outcome-unknown record.
  await input.onProviderOperationId?.(String(publishId));

  try {
    for (let chunkIndex = 0; chunkIndex < uploadPlan.totalChunkCount; chunkIndex += 1) {
      const start = chunkIndex * uploadPlan.chunkSize;
      const end = chunkIndex === uploadPlan.totalChunkCount - 1
        ? stat.size - 1
        : Math.min(stat.size - 1, start + uploadPlan.chunkSize - 1);
      const contentLength = end - start + 1;
      const stream = fs.createReadStream(input.filePath!, { start, end });
      const abortStream = () => stream.destroy(input.signal?.reason instanceof Error
        ? input.signal.reason
        : Object.assign(new Error('upload_aborted'), { code: 'ERR_CANCELED' }));
      input.signal?.addEventListener('abort', abortStream, { once: true });
      try {
        await axios.put(uploadUrl, stream, {
          headers: {
            'Content-Type': mimeType(input.filePath!),
            'Content-Length': String(contentLength),
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: Math.max(1_000, deadlineMs - Date.now()),
          signal: input.signal,
        });
      } finally {
        input.signal?.removeEventListener('abort', abortStream);
        if (!stream.destroyed) stream.destroy();
      }
    }
  } catch (error) {
    throw attachTikTokUnknownOutcome(error, String(publishId), 'TikTok 上传后未返回确定发布结果');
  }

  const publicPostId = await waitForTikTokPublishComplete({
    accessToken,
    publishId: String(publishId),
    signal: input.signal,
    timeoutMs,
    deadlineMs,
    publicPostIdRequired: publishOptions.privacyLevel === 'PUBLIC_TO_EVERYONE',
  }, dependencies);

  return {
    id: publicPostId,
    title,
    privacyStatus: publishOptions.privacyLevel,
    url: '',
    providerOperationId: String(publishId),
  };
}

export async function exchangeMetaCode(input: {
  appId: string;
  appSecret: string;
  code: string;
  redirectUri: string;
  graphVersion: string;
}) {
  const res = await axios.get(`${META_GRAPH}/${input.graphVersion}/oauth/access_token`, {
    params: {
      client_id: input.appId,
      client_secret: input.appSecret,
      redirect_uri: input.redirectUri,
      code: input.code,
    },
  });
  return String(res.data.access_token || '');
}

export async function getMetaPages(accessToken: string, graphVersion: string): Promise<MetaPage[]> {
  const res = await axios.get(`${META_GRAPH}/${graphVersion}/me/accounts`, {
    params: {
      access_token: accessToken,
      fields: 'id,name,access_token,fan_count,picture{url},instagram_business_account{id,username,profile_picture_url,followers_count,media_count}',
      limit: 100,
    },
  });
  return (res.data?.data ?? []).map((page: any) => ({
    id: String(page.id),
    name: String(page.name || 'Facebook Page'),
    accessToken: String(page.access_token || ''),
    pictureUrl: page.picture?.data?.url,
    fanCount: Number(page.fan_count || 0),
    instagram: page.instagram_business_account ? {
      id: String(page.instagram_business_account.id),
      username: String(page.instagram_business_account.username || 'Instagram'),
      profilePictureUrl: page.instagram_business_account.profile_picture_url,
      followersCount: Number(page.instagram_business_account.followers_count || 0),
      mediaCount: Number(page.instagram_business_account.media_count || 0),
    } : undefined,
  }));
}

function normalizeMetaPage(page: any, accessTokenFallback = ''): MetaPage {
  return {
    id: String(page.id),
    name: String(page.name || 'Facebook Page'),
    accessToken: String(page.access_token || accessTokenFallback || ''),
    pictureUrl: page.picture?.data?.url,
    fanCount: Number(page.fan_count || 0),
    instagram: page.instagram_business_account ? {
      id: String(page.instagram_business_account.id),
      username: String(page.instagram_business_account.username || 'Instagram'),
      profilePictureUrl: page.instagram_business_account.profile_picture_url,
      followersCount: Number(page.instagram_business_account.followers_count || 0),
      mediaCount: Number(page.instagram_business_account.media_count || 0),
    } : undefined,
  };
}

export async function getMetaBusinessPages(accessToken: string, graphVersion: string): Promise<MetaPage[]> {
  const fields = [
    'id',
    'name',
    'owned_pages.limit(100){id,name,access_token,fan_count,picture{url},instagram_business_account{id,username,profile_picture_url,followers_count,media_count}}',
    'client_pages.limit(100){id,name,access_token,fan_count,picture{url},instagram_business_account{id,username,profile_picture_url,followers_count,media_count}}',
  ].join(',');
  const res = await axios.get(`${META_GRAPH}/${graphVersion}/me/businesses`, {
    params: {
      access_token: accessToken,
      fields,
      limit: 100,
    },
  });
  const pages: MetaPage[] = [];
  for (const business of res.data?.data ?? []) {
    for (const page of business.owned_pages?.data ?? []) pages.push(normalizeMetaPage(page));
    for (const page of business.client_pages?.data ?? []) pages.push(normalizeMetaPage(page));
  }
  const seen = new Set<string>();
  return pages.filter(page => {
    if (!page.id || seen.has(page.id)) return false;
    seen.add(page.id);
    return true;
  });
}

export async function getFacebookPage(pageAccessToken: string, graphVersion: string, pageId?: string): Promise<MetaPage> {
  const node = pageId?.trim() || 'me';
  const res = await axios.get(`${META_GRAPH}/${graphVersion}/${node}`, {
    params: {
      access_token: pageAccessToken,
      fields: 'id,name,fan_count,picture{url}',
    },
  });
  const page = res.data;
  if (!page?.id) throw new Error('Facebook Page token 无法读取主页信息');
  return {
    id: String(page.id),
    name: String(page.name || 'Facebook Page'),
    accessToken: pageAccessToken,
    pictureUrl: page.picture?.data?.url,
    fanCount: Number(page.fan_count || 0),
  };
}

export async function getInstagramAccount(igUserId: string, pageAccessToken: string, graphVersion: string): Promise<MetaInstagramAccount> {
  const res = await axios.get(`${META_GRAPH}/${graphVersion}/${igUserId}`, {
    params: {
      access_token: pageAccessToken,
      fields: 'id,username,profile_picture_url,followers_count,media_count',
    },
  });
  const account = res.data;
  if (!account?.id) throw new Error('Instagram token 无法读取专业账号信息');
  return {
    id: String(account.id),
    username: String(account.username || 'Instagram'),
    profilePictureUrl: account.profile_picture_url,
    followersCount: Number(account.followers_count || 0),
    mediaCount: Number(account.media_count || 0),
  };
}

export async function getInstagramAccountFromPage(pageId: string, pageAccessToken: string, graphVersion: string) {
  const res = await axios.get(`${META_GRAPH}/${graphVersion}/${pageId}`, {
    params: {
      access_token: pageAccessToken,
      fields: 'id,name,instagram_business_account{id,username,profile_picture_url,followers_count,media_count}',
    },
  });
  const page = res.data;
  const account = page?.instagram_business_account;
  if (!account?.id) throw new Error('该 Facebook Page 没有关联 Instagram 专业账号');
  return {
    page: {
      id: String(page.id || pageId),
      name: String(page.name || 'Facebook Page'),
    },
    instagram: {
      id: String(account.id),
      username: String(account.username || 'Instagram'),
      profilePictureUrl: account.profile_picture_url,
      followersCount: Number(account.followers_count || 0),
      mediaCount: Number(account.media_count || 0),
    } satisfies MetaInstagramAccount,
  };
}

export async function getFacebookVideos(pageId: string, pageAccessToken: string, graphVersion: string, maxResults = 25) {
  const res = await axios.get(`${META_GRAPH}/${graphVersion}/${pageId}/videos`, {
    params: {
      access_token: pageAccessToken,
      fields: 'id,title,description,created_time,permalink_url,thumbnails,views,likes.summary(true),comments.summary(true)',
      limit: Math.min(50, maxResults),
    },
  });
  return (res.data?.data ?? []).map((v: any) => ({
    id: String(v.id),
    title: String(v.title || v.description || 'Facebook video'),
    description: String(v.description || ''),
    publishedAt: String(v.created_time || ''),
    thumbnailUrl: String(v.thumbnails?.data?.[0]?.uri || ''),
    viewCount: Number(v.views || 0),
    likeCount: Number(v.likes?.summary?.total_count || 0),
    commentCount: Number(v.comments?.summary?.total_count || 0),
    duration: '',
    permalinkUrl: String(v.permalink_url || ''),
  }));
}

export async function getFacebookComments(videoId: string, pageAccessToken: string, graphVersion: string, maxResults = 50) {
  const res = await axios.get(`${META_GRAPH}/${graphVersion}/${videoId}/comments`, {
    params: {
      access_token: pageAccessToken,
      fields: 'id,from,message,like_count,created_time',
      limit: Math.min(100, maxResults),
    },
  });
  return (res.data?.data ?? []).map((c: any) => ({
    id: String(c.id),
    authorName: String(c.from?.name || 'Facebook user'),
    authorProfileImageUrl: '',
    textDisplay: String(c.message || ''),
    likeCount: Number(c.like_count || 0),
    publishedAt: String(c.created_time || ''),
    videoId,
  }));
}

export async function uploadFacebookVideo(pageId: string, pageAccessToken: string, graphVersion: string, input: SocialUploadInput): Promise<SocialUploadResult> {
  const stat = requireFile(input.filePath);
  const title = (input.title || 'Untitled video').slice(0, 255);
  const form = new FormData();
  form.append('title', title);
  form.append('description', input.description || '');
  form.append('published', input.privacyStatus !== 'private' ? 'true' : 'false');
  form.append('access_token', pageAccessToken);
  const stream = fs.createReadStream(input.filePath!);
  form.append('source', stream, {
    filename: path.basename(input.filePath!),
    contentType: mimeType(input.filePath!),
    knownLength: stat.size,
  });

  const abortStream = () => stream.destroy(input.signal?.reason instanceof Error
    ? input.signal.reason
    : Object.assign(new Error('upload_aborted'), { code: 'ERR_CANCELED' }));
  input.signal?.addEventListener('abort', abortStream, { once: true });
  let res;
  try {
    res = await axios.post(
      `${META_GRAPH_VIDEO}/${graphVersion}/${pageId}/videos`,
      form,
      {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: Math.max(1_000, Number(input.timeoutMs || 10 * 60_000)),
      signal: input.signal,
      },
    );
  } finally {
    input.signal?.removeEventListener('abort', abortStream);
    if (!stream.destroyed) stream.destroy();
  }
  const id = String(res.data?.id || '');
  if (!id) throw new Error('Facebook 未返回视频 ID');
  return {
    id,
    title,
    privacyStatus: input.privacyStatus === 'private' ? 'private' : 'public',
    url: `https://www.facebook.com/${pageId}/videos/${id}`,
  };
}

export async function getInstagramMedia(igUserId: string, pageAccessToken: string, graphVersion: string, maxResults = 25) {
  const res = await axios.get(`${META_GRAPH}/${graphVersion}/${igUserId}/media`, {
    params: {
      access_token: pageAccessToken,
      fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,comments_count,like_count',
      limit: Math.min(50, maxResults),
    },
  });
  return (res.data?.data ?? []).map((m: any) => ({
    id: String(m.id),
    title: String(m.caption || 'Instagram media').slice(0, 120),
    description: String(m.caption || ''),
    publishedAt: String(m.timestamp || ''),
    thumbnailUrl: String(m.thumbnail_url || m.media_url || ''),
    viewCount: 0,
    likeCount: Number(m.like_count || 0),
    commentCount: Number(m.comments_count || 0),
    duration: '',
    permalinkUrl: String(m.permalink || ''),
  }));
}

export async function getInstagramComments(mediaId: string, pageAccessToken: string, graphVersion: string, maxResults = 50) {
  const res = await axios.get(`${META_GRAPH}/${graphVersion}/${mediaId}/comments`, {
    params: {
      access_token: pageAccessToken,
      fields: 'id,text,username,timestamp,like_count',
      limit: Math.min(100, maxResults),
    },
  });
  return (res.data?.data ?? []).map((c: any) => ({
    id: String(c.id),
    authorName: String(c.username || 'Instagram user'),
    authorProfileImageUrl: '',
    textDisplay: String(c.text || ''),
    likeCount: Number(c.like_count || 0),
    publishedAt: String(c.timestamp || ''),
    videoId: mediaId,
  }));
}

export async function replyToFacebookComment(commentId: string, pageAccessToken: string, graphVersion: string, message: string): Promise<{ id: string }> {
  const res = await axios.post(`${META_GRAPH}/${graphVersion}/${commentId}/comments`, null, {
    params: { access_token: pageAccessToken, message },
  });
  return { id: String(res.data?.id || '') };
}

export async function replyToInstagramComment(commentId: string, pageAccessToken: string, graphVersion: string, message: string): Promise<{ id: string }> {
  const res = await axios.post(`${META_GRAPH}/${graphVersion}/${commentId}/replies`, null, {
    params: { access_token: pageAccessToken, message },
  });
  return { id: String(res.data?.id || '') };
}

export function instagramPublishedMediaId(response: unknown, creationId: string): string {
  const envelope = response && typeof response === 'object' && !Array.isArray(response)
    ? response as Record<string, unknown>
    : {};
  const id = String(envelope.id || '').trim();
  if (id) return id;
  throw Object.assign(new Error('Instagram 已提交发布但未返回媒体帖子 ID'), {
    code: 'INSTAGRAM_PUBLISH_OUTCOME_UNKNOWN',
    statusCode: 502,
    providerOperationId: creationId,
    publishFailureClassification: {
      disposition: 'outcome_unknown',
      outcomeUnknown: true,
      retrySafe: false,
      statusCode: 502,
      reason: 'unclassified',
    },
  });
}

export async function publishInstagramReel(igUserId: string, pageAccessToken: string, graphVersion: string, input: SocialUploadInput): Promise<SocialUploadResult> {
  if (!input.videoUrl) {
    throw new Error('Instagram 发布需要公网可访问的视频 URL。请配置 R2_PUBLIC_URL 或传入 videoUrl。');
  }
  const caption = input.description || input.title || '';
  const create = await axios.post(`${META_GRAPH}/${graphVersion}/${igUserId}/media`, null, {
    params: {
      access_token: pageAccessToken,
      media_type: 'REELS',
      video_url: input.videoUrl,
      caption,
    },
    signal: input.signal,
    timeout: Math.max(1_000, Number(input.timeoutMs || 10 * 60_000)),
  });
  const creationId = String(create.data?.id || '');
  if (!creationId) throw new Error('Instagram 未返回媒体容器 ID');
  // The container exists remotely from this point onward. Do not continue to
  // status polling or media_publish until its handle is durably recorded.
  await input.onProviderOperationId?.(creationId);

  await waitForInstagramContainer(creationId, pageAccessToken, graphVersion, input);

  const publish = await axios.post(`${META_GRAPH}/${graphVersion}/${igUserId}/media_publish`, null, {
    params: {
      access_token: pageAccessToken,
      creation_id: creationId,
    },
    signal: input.signal,
    timeout: Math.max(1_000, Number(input.timeoutMs || 10 * 60_000)),
  });
  const id = instagramPublishedMediaId(publish.data, creationId);
  return {
    id,
    title: input.title,
    privacyStatus: 'public',
    url: '',
    providerOperationId: creationId,
  };
}

async function waitForInstagramContainer(
  creationId: string,
  pageAccessToken: string,
  graphVersion: string,
  input: Pick<SocialUploadInput, 'signal' | 'timeoutMs'> = {},
) {
  const maxAttempts = Number(process.env.INSTAGRAM_MEDIA_PUBLISH_MAX_ATTEMPTS ?? 30);
  const intervalMs = Number(process.env.INSTAGRAM_MEDIA_PUBLISH_POLL_MS ?? 3000);
  let lastStatus = '';
  let lastError = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await axios.get(`${META_GRAPH}/${graphVersion}/${creationId}`, {
      params: {
        access_token: pageAccessToken,
        fields: 'id,status,status_code',
      },
      signal: input.signal,
      timeout: Math.max(1_000, Number(input.timeoutMs || 10 * 60_000)),
    });
    lastStatus = String(res.data?.status_code || res.data?.status || '');
    lastError = String(res.data?.status || '');
    if (lastStatus === 'FINISHED') return;
    if (lastStatus === 'ERROR' || lastStatus === 'EXPIRED') {
      throw new Error(`Instagram 视频处理失败：${lastError || lastStatus}`);
    }
    await delay(intervalMs, input.signal);
  }

  throw new Error(`Instagram 视频仍在处理中，请稍后重试。最后状态：${lastStatus || '未知'}`);
}
