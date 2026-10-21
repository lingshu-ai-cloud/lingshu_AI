import type { Request } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from '../storage/index.js';
import { getMyChannelInfo, getChannelAnalytics, type YouTubeConfig } from '../integrations/youtube.js';
import { advancedManualConnectEnabled as readAdvancedManualConnectEnabled, getTenantAwareGoogleOAuthClient } from '../lib/oauthConfig.js';
import { openAccountCredential, sealedYouTubeCredentialPatch, youtubeCredentials } from '../lib/accountCredentials.js';

export const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';
export const GOOGLE_OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export const COL = 'youtube_accounts';

interface PendingOAuthState {
  userId: string;
  tenantId: string;
  returnTo: string;
  expiresAt: number;
}

export const pendingOAuthStates = new Map<string, PendingOAuthState>();

export interface YouTubeAccountRecord {
  tenantId: string;
  userId: string;
  channelId: string;
  channelTitle: string;
  channelDescription?: string;
  customUrl?: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken?: string;
  subscriberCount: number;
  videoCount: number;
  viewCount: number;
  thumbnailUrl?: string;
  connectedAt: string;
  lastSyncAt?: string;
  isMonetized: boolean;
  status: 'connected' | 'error' | 'expired';
}

export function accountYouTubeConfig(record: YouTubeAccountRecord): YouTubeConfig {
  return youtubeCredentials(record as unknown as Record<string, unknown>);
}

export async function getOAuthClient(tenantId?: string) {
  return getTenantAwareGoogleOAuthClient(tenantId);
}

export function advancedManualConnectEnabled() {
  return readAdvancedManualConnectEnabled();
}

function getPublicOrigin(req: Request) {
  const configured = process.env.PUBLIC_BASE_URL?.trim().replace(/\/$/, '');
  if (configured && !configured.includes('your-domain.com')) return configured;

  const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
  const proto = forwardedProto || req.protocol || 'http';
  const host = req.get('host') || `localhost:${process.env.PORT ?? 8788}`;
  return `${proto}://${host}`;
}

export function getYouTubeRedirectUri(req: Request) {
  return `${getPublicOrigin(req)}/api/overseas/youtube/oauth/callback`;
}

export function normalizeReturnTo(value: unknown) {
  if (typeof value !== 'string') return '/';
  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '/';
  return trimmed.slice(0, 300);
}

export function cleanupOAuthStates() {
  const now = Date.now();
  for (const [state, pending] of pendingOAuthStates) {
    if (pending.expiresAt <= now) pendingOAuthStates.delete(state);
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

function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

export function callbackHtml(input: {
  ok: boolean;
  title: string;
  message: string;
  returnTo: string;
  accountId?: string;
  channelTitle?: string;
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
  <style>
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
  <script>
    const payload = ${scriptSafeJson(payload)};
    const fallbackUrl = ${scriptSafeJson(fallbackUrl)};
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(payload, "*");
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

export async function safeChannelAnalytics(config: YouTubeConfig, channelInfo: Awaited<ReturnType<typeof getMyChannelInfo>>) {
  try {
    return await getChannelAnalytics(config);
  } catch (error) {
    console.warn('YouTube analytics unavailable during connect:', error);
    return {
      isMonetized: false,
      totalSubscribers: channelInfo.subscriberCount,
      totalViews: channelInfo.viewCount,
      totalVideos: channelInfo.videoCount,
    };
  }
}

export async function upsertYouTubeAccount(input: {
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
  const refreshToken = input.refreshToken
    || (existingRecord ? openAccountCredential(existingRecord.refreshToken, 'youtube_refresh_token') : '');
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
    ...sealedYouTubeCredentialPatch({
      clientSecret: input.clientSecret,
      refreshToken,
      accessToken: input.accessToken,
    }),
    subscriberCount: channelInfo.subscriberCount,
    videoCount: channelInfo.videoCount,
    viewCount: channelInfo.viewCount,
    thumbnailUrl: channelInfo.thumbnailUrl || '',
    lastSyncAt: now,
    isMonetized: analytics.isMonetized,
    status: 'connected' as const,
  };

  if (existingRecord) {
    await store.update(COL, existingRecord.id, data);
    return { ...existingRecord, ...data };
  }

  const created = await store.create<YouTubeAccountRecord & { id: string }>(COL, {
    ...data,
    connectedAt: now,
  });
  if (!created) throw new Error('保存 YouTube 账号失败');
  return created;
}

export function normalizeVideoPath(input: string) {
  const raw = input.trim();
  return raw.startsWith('file://') ? fileURLToPath(raw) : path.resolve(raw);
}
