import { Router, type Request } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import {
  getMyChannelInfo,
  getMyVideos,
  getVideoComments,
  getMyVideoComments,
  getSuperChats,
  getChannelAnalytics,
  getYouTubeAnalyticsReport,
  verifyYouTubeCredentials,
  getChannelCommentsByApiKey,
  getVideoCommentsByApiKey,
  getChannelIdByHandle,
  exchangeYouTubeOAuthCode,
  type YouTubeConfig,
} from '../integrations/youtube.js';
import {
  advancedManualConnectEnabled as readAdvancedManualConnectEnabled,
  getPublicOrigin,
  getTenantAwareGoogleOAuthClient,
} from '../lib/oauthConfig.js';
import { parseOAuthState, signOAuthState } from '../lib/tenantPlatformApps.js';
import {
  consumeAssistOAuthClaim,
  recordAssistLinkAudit,
  releaseAssistOAuthClaim,
  validateAssistOAuthClaim,
  type AssistOAuthClaim,
} from '../lib/assistLinkCapability.js';
import { classifyPlatformPublishFailure, platformPublishFailureContext, publishVideoToAccount } from '../publishing/platformPublisher.js';
import {
  publicPublishedVideo,
  publicPublishHistoryRecord,
  publicPublishTracking,
} from '../publishing/publicPublication.js';
import { saveSocialMetricSnapshot } from '../socialMetrics/store.js';
import { requirePublishingWriteAccess } from './publishingWriteAccess.js';
import {
  sealYouTubeAccountCredentials,
  youtubeAccountCredentials,
  type YouTubeCredentialRecord,
} from '../security/platformCredentials.js';
import { CREDENTIAL_ENVELOPE_VERSION } from '../security/credentialEnvelope.js';
import { safeProviderError } from '../security/providerError.js';
import { normalizeOAuthReturnTo, safeInlineJson, secureOAuthCallbackResponse } from '../security/oauthCallbackHtml.js';
import {
  consumeOAuthTransaction,
  createOAuthTransaction,
  revalidateOAuthActor,
} from '../security/oauthTransactions.js';

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';
const GOOGLE_OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const YOUTUBE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export const youtubeRouter = Router();

const COL = 'youtube_accounts';

interface PendingOAuthState {
  userId: string;
  tenantId: string;
  returnTo: string;
  expiresAt: number;
  assist?: AssistOAuthClaim;
}

interface YouTubeAccountRecord extends YouTubeCredentialRecord {
  id: string;
  tenantId: string;
  userId: string;
  channelId: string;
  channelTitle: string;
  channelDescription?: string;
  customUrl?: string;
  clientId: string;
  subscriberCount: number;
  videoCount: number;
  viewCount: number;
  thumbnailUrl?: string;
  connectedAt: string;
  lastSyncAt?: string;
  isMonetized: boolean;
  status: 'connected' | 'error' | 'expired';
}

async function youtubeConfigForRecord(record: YouTubeAccountRecord): Promise<YouTubeConfig> {
  const credentials = await youtubeAccountCredentials(record);
  return {
    clientId: record.clientId,
    clientSecret: credentials.clientSecret,
    refreshToken: credentials.refreshToken,
    accessToken: credentials.accessToken,
  };
}

async function getOAuthClient(tenantId?: string) {
  return getTenantAwareGoogleOAuthClient(tenantId);
}

function advancedManualConnectEnabled() {
  return readAdvancedManualConnectEnabled();
}

function getYouTubeRedirectUri(req: Request) {
  return `${getPublicOrigin(req)}/api/overseas/youtube/oauth/callback`;
}

async function releasePendingAssistClaim(pending: PendingOAuthState, reason: string): Promise<void> {
  if (!pending.assist) return;
  const released = await releaseAssistOAuthClaim({
    tenantId: pending.tenantId,
    oauthPlatform: 'youtube',
    claim: pending.assist,
  });
  if (released.ok) {
    await recordAssistLinkAudit(released.record, 'assist_link.released', { metadata: { reason } });
  }
}

function htmlEscape(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function callbackHtml(input: {
  ok: boolean;
  title: string;
  message: string;
  returnTo: string;
  accountId?: string;
  channelTitle?: string;
  targetOrigin: string;
  nonce: string;
}) {
  const payload = {
    source: 'overseas-workbench',
    type: 'youtube-oauth',
    status: input.ok ? 'success' : 'error',
    accountId: input.accountId,
    channelTitle: input.channelTitle,
    message: input.message,
  };
  const separator = input.returnTo.includes('?') ? '&' : '?';
  const fallbackUrl = `${input.returnTo}${separator}youtube_oauth=${input.ok ? 'connected' : 'error'}`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${htmlEscape(input.title)}</title>
  <style nonce="${input.nonce}">
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8fafc; color: #0f172a; }
    main { width: min(420px, calc(100vw - 32px)); padding: 28px; border: 1px solid #e2e8f0; border-radius: 16px; background: #fff; box-shadow: 0 18px 45px rgba(15, 23, 42, 0.08); }
    h1 { margin: 0 0 8px; font-size: 20px; }
    p { margin: 0; color: #64748b; line-height: 1.6; font-size: 14px; }
    a { display: inline-flex; margin-top: 18px; color: #dc2626; font-weight: 700; text-decoration: none; font-size: 14px; }
  </style>
</head>
<body>
  <main>
    <h1>${htmlEscape(input.title)}</h1>
    <p>${htmlEscape(input.message)}</p>
    <a href="${htmlEscape(fallbackUrl)}">返回应用</a>
  </main>
  <script nonce="${input.nonce}">
    const payload = ${safeInlineJson(payload)};
    const fallbackUrl = ${safeInlineJson(fallbackUrl)};
    const targetOrigin = ${safeInlineJson(input.targetOrigin)};
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(payload, targetOrigin);
        window.close();
      } else {
        setTimeout(() => window.location.replace(fallbackUrl), 900);
      }
    } catch {
      setTimeout(() => window.location.replace(fallbackUrl), 900);
    }
  </script>
</body>
</html>`;
}

async function safeChannelAnalytics(config: YouTubeConfig, channelInfo: Awaited<ReturnType<typeof getMyChannelInfo>>) {
  try {
    return await getChannelAnalytics(config);
  } catch (error) {
    console.warn('YouTube analytics unavailable during connect:', safeProviderError(error));
    return {
      isMonetized: false,
      totalSubscribers: channelInfo.subscriberCount,
      totalViews: channelInfo.viewCount,
      totalVideos: channelInfo.videoCount,
    };
  }
}

async function upsertYouTubeAccount(input: {
  userId: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  accessToken?: string;
}) {
  const initialConfig: YouTubeConfig = {
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    refreshToken: input.refreshToken,
    accessToken: input.accessToken,
  };

  const channelInfo = await getMyChannelInfo(initialConfig);
  const existing = await store.list<YouTubeAccountRecord & { id: string }>(COL, {
    where: { tenantId: input.tenantId, channelId: channelInfo.id },
    perPage: 1,
  });

  const existingRecord = existing.items[0];
  const existingCredentials = existingRecord && !input.refreshToken
    ? await youtubeAccountCredentials(existingRecord)
    : null;
  const refreshToken = input.refreshToken || existingCredentials?.refreshToken || '';
  if (!refreshToken) {
    throw new Error('Google 未返回长期授权，请重新连接并确认允许访问 YouTube');
  }

  const config: YouTubeConfig = {
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    refreshToken,
    accessToken: input.accessToken,
  };
  const analytics = await safeChannelAnalytics(config, channelInfo);
  const now = new Date().toISOString();
  const data = {
    tenantId: input.tenantId,
    userId: input.userId,
    channelId: channelInfo.id,
    channelTitle: channelInfo.title,
    channelDescription: channelInfo.description || '',
    customUrl: channelInfo.customUrl || '',
    clientId: input.clientId,
    subscriberCount: channelInfo.subscriberCount,
    videoCount: channelInfo.videoCount,
    viewCount: channelInfo.viewCount,
    thumbnailUrl: channelInfo.thumbnailUrl || '',
    lastSyncAt: now,
    isMonetized: analytics.isMonetized,
    status: 'connected' as const,
  };

  let target = existingRecord;
  if (!target) {
    const ensured = await store.createIfAbsent<YouTubeAccountRecord>(COL, {
      tenantId: input.tenantId,
      channelId: channelInfo.id,
    }, {
      ...data,
      connectedAt: now,
      credentialVersion: CREDENTIAL_ENVELOPE_VERSION,
      credentialState: 'reconnect_required',
      credentialRevision: 0,
    });
    target = ensured.record;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = attempt === 0 ? target : await store.getById<YouTubeAccountRecord>(COL, target.id);
    if (!current) throw new Error('保存 YouTube 账号失败');
    const revision = Number(current.credentialRevision || 0);
    const sealed = sealYouTubeAccountCredentials(current, {
      clientSecret: input.clientSecret,
      refreshToken,
      accessToken: input.accessToken,
    });
    const expected: Record<string, string | number | boolean> = current.credentialRevision === undefined
      ? { status: String(current.status || '') }
      : { credentialRevision: revision };
    const result = await store.compareAndSet<YouTubeAccountRecord>(COL, current.id, expected, {
      ...data,
      ...sealed,
      credentialRevision: revision + 1,
    });
    if (result.ok) return result.record;
    if (result.reason === 'not_found') throw new Error('保存 YouTube 账号失败');
  }
  throw new Error('youtube_account_write_conflict');
}

function readableYouTubeError(error: any) {
  const oauthError = error?.response?.data?.error;
  const oauthDescription = error?.response?.data?.error_description;
  const apiMessage = error?.response?.data?.error?.message;
  const reason = error?.response?.data?.error?.errors?.[0]?.reason;
  if (oauthError === 'invalid_grant') {
    return '授权凭据无效或已过期。请重新登录 YouTube 授权，或联系服务顾问协助处理。';
  }
  if (oauthError === 'invalid_client') {
    return '授权应用配置不匹配。请联系服务顾问确认平台应用配置。';
  }
  if (String(oauthDescription ?? '').toLowerCase().includes('bad request')) {
    return 'Google 拒绝了本次授权参数。请重新授权，或联系服务顾问协助处理。';
  }
  if (reason === 'insufficientPermissions') {
    return '当前 YouTube 授权缺少上传权限，请重新连接账号并勾选 youtube.upload 权限';
  }
  if (reason === 'accessNotConfigured') {
    return '当前 Google Cloud 项目还没有启用 YouTube Data API v3，请先启用后再重试。';
  }
  if (reason === 'quotaExceeded') {
    return 'YouTube API 配额不足，今天暂时无法继续上传';
  }
  if (error?.message === 'No channel found') {
    return '这个 Google 账号没有可用的 YouTube 频道，请先登录 YouTube 创建频道后再连接。';
  }
  if (error?.message === '保存 YouTube 账号失败') {
    return 'YouTube 账号验证成功，但保存到数据库失败。请确认 PocketBase 已创建 youtube_accounts 表。';
  }
  return safeProviderError(error).message || 'YouTube 请求失败';
}

/**
 * GET /youtube/oauth/callback
 * Google redirects here after the customer approves YouTube access.
 */
youtubeRouter.get('/oauth/callback', async (req, res) => {
  const callbackNonce = secureOAuthCallbackResponse(res);
  const targetOrigin = getPublicOrigin(req);
  const state = String(req.query.state ?? '');
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const oauthError = typeof req.query.error === 'string' ? req.query.error : '';
  const oauthErrorDescription = typeof req.query.error_description === 'string' ? req.query.error_description : '';

  const signedState = parseOAuthState(state);
  const signedAssist = signedState?.assist
    ? await validateAssistOAuthClaim({ tenantId: signedState.tenantId, oauthPlatform: 'youtube', claim: signedState.assist })
    : null;
  const signedStateValid = signedState
    && signedState.platform === 'youtube'
    && (!signedState.assist || signedAssist?.ok);
  let pending: PendingOAuthState | undefined;
  if (signedStateValid && signedState) {
    if (signedState.assist) {
      pending = {
        userId: signedState.userId,
        tenantId: signedState.tenantId,
        returnTo: signedState.returnTo,
        expiresAt: signedState.expiresAt,
        assist: signedState.assist,
      };
    } else {
      try {
        const consumed = await consumeOAuthTransaction({
          state,
          expected: {
            userId: signedState.userId,
            tenantId: signedState.tenantId,
            platform: 'youtube',
            returnTo: signedState.returnTo,
            expiresAt: signedState.expiresAt,
          },
        });
        if (consumed.ok) pending = consumed.identity;
      } catch (error) {
        console.error('[youtube-oauth:transaction-consume-failed]', safeProviderError(error));
        res.status(503).type('html').send(callbackHtml({
          ok: false,
          title: '授权状态暂不可用',
          message: '系统暂时无法安全确认本次授权，请回到应用后重新连接。',
          returnTo: signedState.returnTo,
          targetOrigin,
          nonce: callbackNonce,
        }));
        return;
      }
    }
  }
  const returnTo = pending?.returnTo ?? '/';

  if (!pending) {
    res.status(400).type('html').send(callbackHtml({
      ok: false,
      title: 'YouTube 授权已失效',
      message: '请回到系统里重新点击“连接 YouTube”。',
      returnTo,
      targetOrigin,
      nonce: callbackNonce,
    }));
    return;
  }

  let actorValid = false;
  try {
    actorValid = await revalidateOAuthActor(pending);
  } catch (error) {
    console.error('[youtube-oauth:actor-revalidation-failed]', safeProviderError(error));
  }
  if (!actorValid) {
    await releasePendingAssistClaim(pending, 'actor_access_revoked').catch(() => undefined);
    res.status(403).type('html').send(callbackHtml({
      ok: false,
      title: '授权权限已变更',
      message: '发起授权的成员已离开企业、切换企业或不再拥有账号连接权限。',
      returnTo,
      targetOrigin,
      nonce: callbackNonce,
    }));
    return;
  }

  if (oauthError) {
    await releasePendingAssistClaim(pending, 'provider_denied');
    res.status(400).type('html').send(callbackHtml({
      ok: false,
      title: 'YouTube 授权未完成',
      message: oauthErrorDescription || oauthError,
      returnTo,
      targetOrigin,
      nonce: callbackNonce,
    }));
    return;
  }

  if (!code) {
    await releasePendingAssistClaim(pending, 'authorization_code_missing');
    res.status(400).type('html').send(callbackHtml({
      ok: false,
      title: '缺少授权码',
      message: 'Google 没有返回授权码，请重新连接 YouTube。',
      returnTo,
      targetOrigin,
      nonce: callbackNonce,
    }));
    return;
  }

  const client = await getOAuthClient(pending.tenantId);
  if (!client) {
    await releasePendingAssistClaim(pending, 'oauth_client_unavailable');
    res.status(503).type('html').send(callbackHtml({
      ok: false,
      title: 'YouTube 一键授权暂未开启',
      message: '请联系服务顾问配置平台应用和回调地址。',
      returnTo,
      targetOrigin,
      nonce: callbackNonce,
    }));
    return;
  }

  let accountPersisted = false;
  try {
    const tokens = await exchangeYouTubeOAuthCode({
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      code,
      redirectUri: getYouTubeRedirectUri(req),
    });
    const record = await upsertYouTubeAccount({
      userId: pending.userId,
      tenantId: pending.tenantId,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
    });
    accountPersisted = true;

    if (pending.assist) {
      const consumed = await consumeAssistOAuthClaim({
        tenantId: pending.tenantId,
        oauthPlatform: 'youtube',
        claim: pending.assist,
        connectedAccountId: record.id,
      });
      if (!consumed.ok) throw new Error(`assist_link_consume_failed:${consumed.reason}`);
      await recordAssistLinkAudit(consumed.record, 'assist_link.consumed', {
        metadata: { connectedAccountId: record.id, connectedAccountCount: 1 },
      });
    }

    res.type('html').send(callbackHtml({
      ok: true,
      title: 'YouTube 已连接',
      message: `${record.channelTitle} 已连接成功，可以关闭这个窗口。`,
      returnTo,
      accountId: record.id,
      channelTitle: record.channelTitle,
      targetOrigin,
      nonce: callbackNonce,
    }));
  } catch (error: any) {
    if (pending.assist && !accountPersisted) {
      await releasePendingAssistClaim(pending, 'oauth_callback_failed').catch(releaseError => {
        console.error('[assist-link:release-failed]', { linkId: pending.assist?.linkId, reason: String((releaseError as Error)?.message || releaseError) });
      });
    }
    console.error('YouTube OAuth callback error:', safeProviderError(error));
    res.status(500).type('html').send(callbackHtml({
      ok: false,
      title: 'YouTube 连接失败',
      message: readableYouTubeError(error),
      returnTo,
      targetOrigin,
      nonce: callbackNonce,
    }));
  }
});

youtubeRouter.use(requireAuth);
youtubeRouter.use(requirePublishingWriteAccess);

/**
 * GET /youtube/oauth/status
 * Let the UI know whether one-click YouTube OAuth is ready.
 */
youtubeRouter.get('/oauth/status', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const client = await getOAuthClient(tenantId);
  res.json({
    configured: Boolean(client),
    redirectUri: getYouTubeRedirectUri(req),
    scopes: YOUTUBE_OAUTH_SCOPES,
    manualConnectEnabled: advancedManualConnectEnabled(),
  });
});

/**
 * POST /youtube/oauth/start
 * Creates a short-lived state and returns the Google authorization URL.
 */
youtubeRouter.post('/oauth/start', async (req, res) => {
  const { userId, tenantId } = res.locals as AuthLocals;
  const client = await getOAuthClient(tenantId);
  if (!client) {
    res.status(503).json({
      error: 'YouTube 一键授权暂未开启，请联系服务顾问配置平台应用和回调地址。',
    });
    return;
  }

  const returnTo = normalizeOAuthReturnTo(req.body?.returnTo);
  const expiresAt = Date.now() + OAUTH_STATE_TTL_MS;
  const state = signOAuthState({
    userId,
    tenantId,
    platform: 'youtube',
    returnTo,
    expiresAt,
  });
  try {
    await createOAuthTransaction({ state, userId, tenantId, platform: 'youtube', returnTo, expiresAt });
  } catch (error) {
    console.error('[youtube-oauth:transaction-create-failed]', safeProviderError(error));
    res.status(503).json({ error: 'oauth_transaction_unavailable' });
    return;
  }

  const url = new URL(GOOGLE_OAUTH_URL);
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('redirect_uri', getYouTubeRedirectUri(req));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', YOUTUBE_OAUTH_SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);

  res.json({
    url: url.toString(),
    redirectUri: getYouTubeRedirectUri(req),
    expiresInSeconds: Math.floor(OAUTH_STATE_TTL_MS / 1000),
  });
});

/**
 * POST /youtube/connect
 * Connect a YouTube account with OAuth tokens
 * Body: { refreshToken, accessToken?, clientId?, clientSecret? }
 */
youtubeRouter.post('/connect', async (req, res) => {
  const { userId, tenantId } = res.locals as AuthLocals;
  if (!advancedManualConnectEnabled()) {
    res.status(403).json({ error: 'Advanced manual connect is disabled' });
    return;
  }

  const client = await getOAuthClient(tenantId);
  const clientId = String(req.body?.clientId || client?.clientId || '').trim();
  const clientSecret = String(req.body?.clientSecret || client?.clientSecret || '').trim();
  const refreshToken = String(req.body?.refreshToken || '').trim();
  const accessToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : undefined;

  if (!clientId || !clientSecret || !refreshToken) {
    res.status(400).json({ error: 'YouTube 授权信息不完整，请重新授权或联系服务顾问协助处理。' });
    return;
  }

  try {
    const record = await upsertYouTubeAccount({
      userId,
      tenantId,
      clientId,
      clientSecret,
      refreshToken,
      accessToken,
    });

    res.json({
      id: record.id,
      channelId: record.channelId,
      channelTitle: record.channelTitle,
      status: record.status,
    });
  } catch (error: any) {
    console.error('YouTube connect error:', safeProviderError(error));
    const status = error?.response?.status === 401 ? 401 : error?.response?.status === 403 ? 403 : 500;
    res.status(status).json({ error: readableYouTubeError(error) });
  }
});

/**
 * GET /youtube/accounts
 * List connected YouTube accounts for the tenant
 */
youtubeRouter.get('/accounts', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;

  const result = await store.list(COL, {
    where: { tenantId },
    sort: '-connectedAt',
  });

  res.json({
    items: result.items.map((item: any) => ({
      id: item.id,
      channelId: item.channelId,
      channelTitle: item.channelTitle,
      channelDescription: item.channelDescription,
      customUrl: item.customUrl,
      thumbnailUrl: item.thumbnailUrl,
      subscriberCount: item.subscriberCount,
      videoCount: item.videoCount,
      viewCount: item.viewCount,
      isMonetized: item.isMonetized,
      status: item.status,
      connectedAt: item.connectedAt,
      lastSyncAt: item.lastSyncAt,
    })),
    total: result.totalItems,
  });
});

/**
 * GET /youtube/accounts/:id
 * Get a specific YouTube account
 */
youtubeRouter.get('/accounts/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const record = await store.getById(COL, req.params.id);

  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  res.json({
    id: record.id,
    channelId: record.channelId,
    channelTitle: record.channelTitle,
    channelDescription: record.channelDescription,
    customUrl: record.customUrl,
    thumbnailUrl: record.thumbnailUrl,
    subscriberCount: record.subscriberCount,
    videoCount: record.videoCount,
    viewCount: record.viewCount,
    isMonetized: record.isMonetized,
    status: record.status,
    connectedAt: record.connectedAt,
    lastSyncAt: record.lastSyncAt,
  });
});

/**
 * DELETE /youtube/accounts/:id
 * Disconnect a YouTube account
 */
youtubeRouter.delete('/accounts/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const record = await store.getById(COL, req.params.id);

  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  await store.delete(COL, req.params.id);
  res.json({ ok: true });
});

/**
 * GET /youtube/accounts/:id/channel-info
 * Get channel information
 */
youtubeRouter.get('/accounts/:id/channel-info', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const record = await store.getById(COL, req.params.id) as YouTubeAccountRecord;

  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  try {
    const config = await youtubeConfigForRecord(record);

    const info = await getMyChannelInfo(config);
    res.json(info);
  } catch (error) {
    console.error('Error fetching channel info:', safeProviderError(error));
    res.status(500).json({ error: 'Failed to fetch channel info' });
  }
});

/**
 * GET /youtube/accounts/:id/videos
 * Get all videos from the YouTube channel
 * Query: maxResults (default 50)
 */
youtubeRouter.get('/accounts/:id/videos', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const { maxResults = '50' } = req.query;
  const record = await store.getById(COL, req.params.id) as YouTubeAccountRecord;

  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  try {
    const config = await youtubeConfigForRecord(record);

    const videos = await getMyVideos(config, Number(maxResults));
    res.json({ videos });
  } catch (error) {
    console.error('Error fetching videos:', safeProviderError(error));
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

/**
 * POST /youtube/accounts/:id/upload
 * Upload a locally rendered video file to the connected YouTube channel.
 * Body: { videoPath, title, description?, tags?, privacyStatus?, madeForKids? }
 */
youtubeRouter.post('/accounts/:id/upload', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const record = await store.getById(COL, req.params.id) as YouTubeAccountRecord;

  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  if (record.status !== 'connected') {
    res.status(400).json({ error: 'YouTube account is not connected' });
    return;
  }

  const {
    videoPath,
    title,
    description = '',
    tags,
    privacyStatus = 'unlisted',
    madeForKids = false,
    projectId,
    generationVersionId,
    ratio,
    language,
    contentId,
    idempotencyKey,
    trackWaLink = true,
  } = req.body as {
    videoPath?: string;
    title?: string;
    description?: string;
    tags?: unknown;
    privacyStatus?: 'private' | 'unlisted' | 'public';
    madeForKids?: boolean;
    projectId?: string;
    generationVersionId?: string;
    ratio?: string;
    language?: string;
    contentId?: string;
    idempotencyKey?: string;
    trackWaLink?: boolean;
  };

  if (!videoPath || !title) {
    res.status(400).json({ error: 'videoPath and title are required' });
    return;
  }
  if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,200}$/.test(idempotencyKey)) {
    res.status(400).json({ error: 'valid idempotencyKey is required' });
    return;
  }
  if (!['private', 'unlisted', 'public'].includes(privacyStatus)) {
    res.status(400).json({ error: 'privacyStatus must be private, unlisted, or public' });
    return;
  }

  try {
    const result = await publishVideoToAccount({
      tenantId,
      accountId: req.params.id,
      platform: 'youtube',
      videoPath,
      title,
      description,
      tags,
      privacyStatus,
      madeForKids,
      projectId,
      generationVersionId,
      ratio,
      language,
      contentId,
      idempotencyKey,
      trackWaLink,
    });
    res.status(201).json({
      ok: true,
      video: publicPublishedVideo(result.video),
      tracking: publicPublishTracking(result.tracking),
      publishRecord: publicPublishHistoryRecord(result.publishRecord, tenantId),
    });
  } catch (error: any) {
    console.error('YouTube upload error:', safeProviderError(error));
    const classification = classifyPlatformPublishFailure(error);
    const context = platformPublishFailureContext(error);
    const status = error?.statusCode || (error?.response?.status === 401 ? 401 : error?.response?.status === 403 ? 403 : 500);
    res.status(status).json({
      ok: false,
      error: readableYouTubeError(error),
      outcomeUnknown: classification.outcomeUnknown,
      retrySafe: classification.retrySafe,
      reconciliationRequired: classification.outcomeUnknown,
      reconciliationPersisted: context?.reconciliationPersisted === true,
      trackingPostId: context?.trackingPostId || '',
      alreadyPublished: classification.reason === 'already_published',
      resolution: classification.outcomeUnknown ? 'verify_platform_before_retry' : 'correct_error_then_retry',
    });
  }
});

/**
 * GET /youtube/accounts/:id/comments
 * Get all comments from my videos
 * Query: maxResults (default 1000)
 */
youtubeRouter.get('/accounts/:id/comments', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const { maxResults = '1000' } = req.query;
  const record = await store.getById(COL, req.params.id) as YouTubeAccountRecord;

  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  try {
    const config = await youtubeConfigForRecord(record);

    const comments = await getMyVideoComments(config, Number(maxResults), record.channelId);
    res.json({
      comments,
      total: comments.length,
    });
  } catch (error) {
    console.error('Error fetching comments:', safeProviderError(error));
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

/**
 * GET /youtube/accounts/:id/video/:videoId/comments
 * Get comments on a specific video
 * Query: maxResults (default 100)
 */
youtubeRouter.get('/accounts/:id/video/:videoId/comments', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const { maxResults = '100' } = req.query;
  const { videoId } = req.params;
  const record = await store.getById(COL, req.params.id) as YouTubeAccountRecord;

  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  try {
    const config = await youtubeConfigForRecord(record);

    const comments = await getVideoComments(config, videoId, Number(maxResults));
    res.json({
      videoId,
      comments,
      total: comments.length,
    });
  } catch (error) {
    console.error('Error fetching video comments:', safeProviderError(error));
    res.status(500).json({ error: 'Failed to fetch video comments' });
  }
});

/**
 * GET /youtube/accounts/:id/analytics
 * Get channel analytics and monetization info
 */
youtubeRouter.get('/accounts/:id/analytics', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const record = await store.getById(COL, req.params.id) as YouTubeAccountRecord;

  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  try {
    const config = await youtubeConfigForRecord(record);

    const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : new Date().toISOString().slice(0, 10);
    const startDefault = new Date(`${endDate}T00:00:00.000Z`);
    startDefault.setUTCDate(startDefault.getUTCDate() - 29);
    const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : startDefault.toISOString().slice(0, 10);
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(startDate) || !datePattern.test(endDate) || startDate > endDate) {
      res.status(400).json({ error: 'startDate/endDate 必须是 YYYY-MM-DD 且开始日期不能晚于结束日期' });
      return;
    }
    const days = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000;
    if (!Number.isFinite(days) || days > 366) {
      res.status(400).json({ error: '单次查询范围不能超过 366 天' });
      return;
    }
    const analytics = await getYouTubeAnalyticsReport(config, { startDate, endDate });
    await Promise.all(analytics.rows.map(row => saveSocialMetricSnapshot({
      tenantId,
      platform: 'youtube',
      accountId: req.params.id,
      capturedAt: `${row.date}T12:00:00.000Z`,
      valueKind: 'daily',
      metrics: {
        views: row.views,
        watchTimeMinutes: row.estimatedMinutesWatched,
        averageViewDurationSeconds: row.averageViewDuration,
        averageViewPercentage: row.averageViewPercentage,
        likes: row.likes,
        comments: row.comments,
        shares: row.shares,
        subscribers: row.subscribersGained,
      },
      rawMetrics: { source: 'youtube_analytics', subscribersLost: row.subscribersLost },
    })));
    res.json({ ...analytics, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Error fetching analytics:', safeProviderError(error));
    const status = (error as any)?.response?.status === 403 ? 403 : 500;
    res.status(status).json({
      error: status === 403
        ? '当前授权没有 YouTube Analytics 读取权限，请重新连接 YouTube 完成授权'
        : 'Failed to fetch analytics',
      ...(status === 403 ? { code: 'YOUTUBE_ANALYTICS_PERMISSION_REQUIRED' } : {}),
    });
  }
});

/**
 * GET /youtube/accounts/:id/super-chats
 * Get super chats and channel memberships
 */
youtubeRouter.get('/accounts/:id/super-chats', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const { videoId } = req.query;
  const record = await store.getById(COL, req.params.id) as YouTubeAccountRecord;

  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  try {
    const config = await youtubeConfigForRecord(record);

    const superChats = await getSuperChats(config, videoId as string);
    res.json({
      superChats,
      total: superChats.length,
    });
  } catch (error) {
    console.error('Error fetching super chats:', safeProviderError(error));
    res.status(500).json({ error: 'Failed to fetch super chats' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// API Key 模式（无需 OAuth，读取公开频道数据）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /youtube/public/comments
 * 用 API Key 拉取频道所有视频的评论
 * Query: channelId (必填) | maxResults | pageToken | order
 */
youtubeRouter.get('/public/comments', async (req, res) => {
  if (!YOUTUBE_API_KEY) {
    res.status(503).json({ error: 'YOUTUBE_API_KEY not configured in .env' });
    return;
  }

  const { channelId, maxResults = '100', pageToken, order = 'time' } = req.query as Record<string, string>;

  if (!channelId) {
    res.status(400).json({ error: 'channelId is required' });
    return;
  }

  try {
    const result = await getChannelCommentsByApiKey(YOUTUBE_API_KEY, channelId, {
      maxResults: Number(maxResults),
      pageToken,
      order: order as 'time' | 'relevance',
    });
    res.json(result);
  } catch (error: any) {
    console.error('Error fetching channel comments by API key:', safeProviderError(error));
    const status = error?.response?.status || 500;
    res.status(status).json({ error: error?.response?.data?.error?.message || 'Failed to fetch comments' });
  }
});

/**
 * GET /youtube/public/video/:videoId/comments
 * 用 API Key 拉取指定视频的评论
 * Query: maxResults | pageToken | order
 */
youtubeRouter.get('/public/video/:videoId/comments', async (req, res) => {
  if (!YOUTUBE_API_KEY) {
    res.status(503).json({ error: 'YOUTUBE_API_KEY not configured in .env' });
    return;
  }

  const { videoId } = req.params;
  const { maxResults = '100', pageToken, order = 'time' } = req.query as Record<string, string>;

  try {
    const result = await getVideoCommentsByApiKey(YOUTUBE_API_KEY, videoId, {
      maxResults: Number(maxResults),
      pageToken,
      order: order as 'time' | 'relevance',
    });
    res.json(result);
  } catch (error: any) {
    console.error('Error fetching video comments by API key:', safeProviderError(error));
    const status = error?.response?.status || 500;
    res.status(status).json({ error: error?.response?.data?.error?.message || 'Failed to fetch comments' });
  }
});

/**
 * GET /youtube/public/resolve-handle
 * 通过 YouTube handle（如 @YourChannel）查询频道 ID
 * Query: handle (必填)
 */
youtubeRouter.get('/public/resolve-handle', async (req, res) => {
  if (!YOUTUBE_API_KEY) {
    res.status(503).json({ error: 'YOUTUBE_API_KEY not configured in .env' });
    return;
  }

  const { handle } = req.query as { handle: string };
  if (!handle) {
    res.status(400).json({ error: 'handle is required' });
    return;
  }

  try {
    const channelId = await getChannelIdByHandle(YOUTUBE_API_KEY, handle);
    if (!channelId) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }
    res.json({ channelId, handle });
  } catch (error: any) {
    console.error('Error resolving channel handle:', safeProviderError(error));
    res.status(500).json({ error: 'Failed to resolve channel handle' });
  }
});

/**
 * POST /youtube/accounts/:id/sync
 * Manually trigger a sync of YouTube data
 */
youtubeRouter.post('/accounts/:id/sync', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const record = await store.getById(COL, req.params.id) as YouTubeAccountRecord;

  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  try {
    const config = await youtubeConfigForRecord(record);

    const channelInfo = await getMyChannelInfo(config);
    const analytics = await safeChannelAnalytics(config, channelInfo);

    await store.update(COL, req.params.id, {
      channelId: channelInfo.id,
      channelTitle: channelInfo.title,
      channelDescription: channelInfo.description,
      customUrl: channelInfo.customUrl || '',
      thumbnailUrl: channelInfo.thumbnailUrl || '',
      subscriberCount: channelInfo.subscriberCount,
      videoCount: analytics.totalVideos,
      viewCount: analytics.totalViews,
      lastSyncAt: new Date().toISOString(),
      status: 'connected',
    });

    res.json({ ok: true, message: 'Sync triggered successfully', channelTitle: channelInfo.title });
  } catch (error) {
    console.error('Error syncing YouTube account:', safeProviderError(error));
    res.status(500).json({ error: 'Failed to sync YouTube account' });
  }
});
