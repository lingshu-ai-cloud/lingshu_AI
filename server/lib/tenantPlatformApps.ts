import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Request } from 'express';
import { store } from '../storage/index.js';
import { getPublicOrigin, getMetaOAuthClient, getTikTokOAuthClient, getYouTubeOAuthClient } from './oauthConfig.js';
import { sendDingTalkMarkdown, sendDingTalkText } from '../integrations/dingtalk.js';
import { sendFeishuCard, sendFeishuText } from '../integrations/feishu.js';
import { sendWeComMarkdown } from '../integrations/wecom.js';
import { CREDENTIAL_ENVELOPE_VERSION, isCredentialEnvelope } from '../security/credentialEnvelope.js';
import {
  quarantineInvalidTenantPlatformCredentials,
  sealTenantPlatformSecret,
  tenantPlatformSecret,
  tenantPlatformSecretMask,
} from '../security/platformCredentials.js';
import type { AssistOAuthClaim } from './assistLinkCapability.js';
import { listAllRecords } from '../storage/pagination.js';
import { hashLegacyMetaWebhookVerifyToken, hashMetaWebhookVerifyToken, isMetaWebhookVerifyTokenHash } from '../security/webhookCredentials.js';

export type TenantPlatform = 'meta' | 'google' | 'tiktok' | 'wecom';
export type TenantTokenType = 'user_60d' | 'system_user_permanent';
export type TenantPlatformStatus =
  | 'pending'
  | 'configuring'
  | 'waiting_customer'
  | 'importing_history'
  | 'verifying'
  | 'active'
  | 'needs_permanent_token'
  | 'token_expired'
  | 'error';

export interface TenantPlatformAppRecord {
  id: string;
  tenant_id: string;
  platform: TenantPlatform;
  app_id?: string;
  app_secret?: string;
  wa_config_id?: string;
  business_id?: string;
  waba_id?: string;
  phone_number_id?: string;
  wa_public_number?: string;
  page_id?: string;
  ig_user_id?: string;
  youtube_channel_id?: string;
  webhook_verify_token?: string;
  wecom_encoding_aes_key?: string;
  token_type?: TenantTokenType;
  access_token?: string;
  token_expires_at?: string;
  status?: TenantPlatformStatus;
  last_checklist?: string;
  notes?: string;
  credential_version?: string;
  credential_state?: 'ready' | 'reconnect_required';
  credential_revision?: number;
}

export interface PublicTenantPlatformApp {
  id: string;
  tenantId: string;
  platform: TenantPlatform;
  appId: string;
  appSecretSet: boolean;
  appSecretMask: string;
  waConfigId: string;
  businessId: string;
  wabaId: string;
  phoneNumberId: string;
  waPublicNumber: string;
  pageId: string;
  igUserId: string;
  youtubeChannelId: string;
  webhookVerifyTokenSet: boolean;
  wecomEncodingAesKeySet: boolean;
  wecomEncodingAesKeyMask: string;
  webhookUrl: string;
  oauthRedirectUri: string;
  tokenType: TenantTokenType;
  accessTokenSet: boolean;
  accessTokenMask: string;
  tokenExpiresAt: string;
  status: TenantPlatformStatus;
  checklist: Record<string, boolean>;
  notes: string;
  credentialState: 'ready' | 'reconnect_required';
}

const COL = 'tenant_platform_apps';
const STATE_TTL_MS = 10 * 60 * 1000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const ENTERPRISE_FILE = path.join(DATA_DIR, 'enterprise.json');
const DAILY_BRIEFING_QUEUE_FILE = path.join(DATA_DIR, 'daily-briefing-queue.json');
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function oauthStateKey(): Buffer {
  const tenantKey = text(process.env.TENANT_PLATFORM_APP_KEY);
  const raw = tenantKey || text(process.env.OAUTH_STATE_SECRET) || 'lingshu-local-dev-tenant-platform-key';
  return crypto.createHash('sha256').update(raw).digest();
}

export async function getTenantPlatformApp(tenantId: string, platform: TenantPlatform): Promise<TenantPlatformAppRecord | null> {
  const result = await store.list<TenantPlatformAppRecord>(COL, {
    where: { tenant_id: tenantId, platform },
    perPage: 1,
  });
  const app = result.items[0] ?? null;
  if (!app) return null;
  const hardened = await hardenWebhookVerifyCredential(app);
  return quarantineInvalidTenantPlatformCredentials(hardened);
}

async function hardenWebhookVerifyCredential(app: TenantPlatformAppRecord): Promise<TenantPlatformAppRecord> {
  const stored = text(app.webhook_verify_token);
  if (!stored) return app;
  let hardened = '';
  if (app.platform === 'meta' && !isMetaWebhookVerifyTokenHash(stored)) {
    hardened = hashLegacyMetaWebhookVerifyToken(stored);
  } else if (app.platform === 'wecom' && !isCredentialEnvelope(stored)) {
    hardened = sealTenantPlatformSecret(app, 'webhook_verify_token', stored);
  }
  if (!hardened) return app;
  const revision = Number(app.credential_revision || 0);
  const expected: Record<string, string | number | boolean> = app.credential_revision === undefined
    ? { platform: app.platform }
    : { credential_revision: revision };
  const result = await store.compareAndSet<TenantPlatformAppRecord>(COL, app.id, expected, {
    webhook_verify_token: hardened,
    credential_version: CREDENTIAL_ENVELOPE_VERSION,
    credential_revision: revision + 1,
  });
  return result.ok ? result.record : app;
}

export async function listTenantPlatformApps(): Promise<TenantPlatformAppRecord[]> {
  const apps = await listAllRecords<TenantPlatformAppRecord & Record<string, unknown>>({
    store,
    collection: COL,
    query: { sort: 'tenant_id' },
    pageSize: 500,
    maxRecords: 250_000,
  });
  return Promise.all(apps.map(async app => quarantineInvalidTenantPlatformCredentials(await hardenWebhookVerifyCredential(app))));
}

export async function deleteTenantPlatformApp(tenantId: string, platform: TenantPlatform): Promise<boolean> {
  const app = await getTenantPlatformApp(tenantId, platform);
  if (!app) return false;
  return store.delete(COL, app.id);
}

export function tenantWebhookUrl(req: Request, tenantId: string, platform: TenantPlatform = 'meta'): string {
  const path = platform === 'wecom' ? 'wecom' : 'meta';
  return `${getPublicOrigin(req)}/api/webhooks/${path}/${encodeURIComponent(tenantId)}`;
}

export function publicTenantPlatformApp(req: Request, app: TenantPlatformAppRecord): PublicTenantPlatformApp {
  const checklist = (() => {
    try {
      const parsed = JSON.parse(text(app.last_checklist) || '{}');
      return parsed && typeof parsed === 'object' ? parsed as Record<string, boolean> : {};
    } catch {
      return {};
    }
  })();
  const appSecretMask = tenantPlatformSecretMask(app, 'app_secret');
  const accessTokenMask = tenantPlatformSecretMask(app, 'access_token');
  const wecomEncodingAesKeyMask = tenantPlatformSecretMask(app, 'wecom_encoding_aes_key');
  const numericAssetId = (value: unknown) => /^\d+$/.test(text(value)) ? text(value) : '';
  return {
    id: app.id,
    tenantId: app.tenant_id,
    platform: app.platform,
    appId: text(app.app_id),
    appSecretSet: Boolean(appSecretMask),
    appSecretMask,
    waConfigId: text(app.wa_config_id),
    businessId: text(app.business_id),
    wabaId: text(app.waba_id),
    phoneNumberId: text(app.phone_number_id),
    waPublicNumber: text(app.wa_public_number),
    pageId: numericAssetId(app.page_id),
    igUserId: numericAssetId(app.ig_user_id),
    youtubeChannelId: text(app.youtube_channel_id),
    webhookVerifyTokenSet: app.platform === 'meta'
      ? isMetaWebhookVerifyTokenHash(app.webhook_verify_token)
      : app.platform === 'wecom' && Boolean(tenantPlatformSecretMask(app, 'webhook_verify_token')),
    wecomEncodingAesKeySet: Boolean(wecomEncodingAesKeyMask),
    wecomEncodingAesKeyMask,
    webhookUrl: app.platform === 'meta' || app.platform === 'wecom' ? tenantWebhookUrl(req, app.tenant_id, app.platform) : '',
    oauthRedirectUri: app.platform === 'google'
      ? `${getPublicOrigin(req)}/api/overseas/youtube/oauth/callback`
      : app.platform === 'tiktok'
        ? `${getPublicOrigin(req)}/api/overseas/social/oauth/tiktok/callback`
        : '',
    tokenType: app.token_type || 'user_60d',
    accessTokenSet: Boolean(accessTokenMask),
    accessTokenMask,
    tokenExpiresAt: text(app.token_expires_at),
    status: app.status || 'pending',
    checklist,
    notes: text(app.notes),
    credentialState: app.credential_state === 'reconnect_required' ? 'reconnect_required' : 'ready',
  };
}

export async function upsertTenantPlatformApp(input: {
  tenantId: string;
  platform: TenantPlatform;
  appId?: string;
  appSecret?: string;
  waConfigId?: string;
  businessId?: string;
  wabaId?: string;
  phoneNumberId?: string;
  waPublicNumber?: string;
  pageId?: string;
  igUserId?: string;
  youtubeChannelId?: string;
  webhookVerifyToken?: string;
  wecomEncodingAesKey?: string;
  tokenType?: TenantTokenType;
  accessToken?: string;
  tokenExpiresAt?: string;
  status?: TenantPlatformStatus;
  checklist?: Record<string, boolean>;
  notes?: string;
}): Promise<TenantPlatformAppRecord> {
  const initial = await getTenantPlatformApp(input.tenantId, input.platform);
  if (!initial) {
    await store.createIfAbsent<TenantPlatformAppRecord>(COL, {
      tenant_id: input.tenantId,
      platform: input.platform,
    }, {
      webhook_verify_token: '',
      token_type: input.tokenType || 'user_60d',
      status: input.status || 'pending',
      credential_version: CREDENTIAL_ENVELOPE_VERSION,
      credential_state: 'ready',
      credential_revision: 0,
    });
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await getTenantPlatformApp(input.tenantId, input.platform);
    if (!current) throw new Error('tenant_platform_app_create_failed');
    const revision = Number(current.credential_revision || 0);
    const patch: Record<string, unknown> = {
      token_type: input.tokenType || current.token_type || 'user_60d',
      status: input.status || current.status || 'pending',
      credential_version: CREDENTIAL_ENVELOPE_VERSION,
      credential_revision: revision + 1,
    };
    if (input.appId !== undefined) patch.app_id = input.appId;
    if (input.appSecret) patch.app_secret = sealTenantPlatformSecret(current, 'app_secret', input.appSecret);
    if (input.waConfigId !== undefined) patch.wa_config_id = input.waConfigId;
    if (input.businessId !== undefined) patch.business_id = input.businessId;
    if (input.wabaId !== undefined) patch.waba_id = input.wabaId;
    if (input.phoneNumberId !== undefined) patch.phone_number_id = input.phoneNumberId;
    if (input.waPublicNumber !== undefined) patch.wa_public_number = input.waPublicNumber;
    if (input.pageId !== undefined) patch.page_id = input.pageId;
    if (input.igUserId !== undefined) patch.ig_user_id = input.igUserId;
    if (input.youtubeChannelId !== undefined) patch.youtube_channel_id = input.youtubeChannelId;
    if (input.webhookVerifyToken) {
      if (input.platform === 'meta') {
        patch.webhook_verify_token = hashMetaWebhookVerifyToken(input.webhookVerifyToken);
      } else if (input.platform === 'wecom') {
        patch.webhook_verify_token = sealTenantPlatformSecret(current, 'webhook_verify_token', input.webhookVerifyToken);
      } else {
        throw new Error('webhook_verify_token_platform_invalid');
      }
    }
    if (input.wecomEncodingAesKey) patch.wecom_encoding_aes_key = sealTenantPlatformSecret(current, 'wecom_encoding_aes_key', input.wecomEncodingAesKey);
    if (input.accessToken) patch.access_token = sealTenantPlatformSecret(current, 'access_token', input.accessToken);
    if (input.appSecret || input.webhookVerifyToken || input.wecomEncodingAesKey || input.accessToken) patch.credential_state = 'ready';
    if (input.tokenExpiresAt !== undefined) patch.token_expires_at = input.tokenExpiresAt;
    if (input.checklist !== undefined) patch.last_checklist = JSON.stringify(input.checklist);
    if (input.notes !== undefined) patch.notes = input.notes;

    const expected: Record<string, string | number | boolean> = current.credential_revision === undefined
      ? { platform: current.platform }
      : { credential_revision: revision };
    const result = await store.compareAndSet<TenantPlatformAppRecord>(COL, current.id, expected, patch);
    if (result.ok) return result.record;
    if (result.reason === 'not_found') throw new Error('tenant_platform_app_not_found');
  }
  throw new Error('tenant_platform_app_write_conflict');
}

export async function markTenantPlatformStatus(
  id: string,
  status: TenantPlatformStatus,
  expectedCredentialRevision: number,
  notes?: string,
): Promise<boolean> {
  const result = await store.compareAndSet<TenantPlatformAppRecord>(COL, id, {
    credential_revision: expectedCredentialRevision,
  }, {
    status,
    credential_revision: expectedCredentialRevision + 1,
    ...(notes ? { notes: text(notes).slice(0, 500) } : {}),
  });
  return result.ok;
}

export async function getTenantMetaOAuthClient(tenantId?: string): Promise<{ appId: string; appSecret: string } | null> {
  if (tenantId) {
    const app = await getTenantPlatformApp(tenantId, 'meta');
    const appId = text(app?.app_id);
    const appSecret = app ? tenantPlatformSecret(app, 'app_secret') : '';
    if (appId && appSecret) return { appId, appSecret };
  }
  return getMetaOAuthClient();
}

export async function getTenantGoogleOAuthClient(tenantId?: string): Promise<{ clientId: string; clientSecret: string } | null> {
  if (tenantId) {
    const app = await getTenantPlatformApp(tenantId, 'google');
    const clientId = text(app?.app_id);
    const clientSecret = app ? tenantPlatformSecret(app, 'app_secret') : '';
    if (clientId && clientSecret) return { clientId, clientSecret };
  }
  return getYouTubeOAuthClient();
}

export async function getTenantTikTokOAuthClient(tenantId?: string): Promise<{ clientKey: string; clientSecret: string } | null> {
  if (tenantId) {
    const app = await getTenantPlatformApp(tenantId, 'tiktok');
    const clientKey = text(app?.app_id);
    const clientSecret = app ? tenantPlatformSecret(app, 'app_secret') : '';
    if (clientKey && clientSecret) return { clientKey, clientSecret };
  }
  return getTikTokOAuthClient();
}

export function signOAuthState(input: {
  tenantId: string;
  userId: string;
  platform: string;
  returnTo: string;
  nonce?: string;
  expiresAt?: number;
  assist?: AssistOAuthClaim;
}): string {
  const payload = {
    tenantId: input.tenantId,
    userId: input.userId,
    platform: input.platform,
    returnTo: input.returnTo,
    nonce: input.nonce || crypto.randomBytes(12).toString('base64url'),
    expiresAt: input.expiresAt || Date.now() + STATE_TTL_MS,
    ...(input.assist ? { assist: input.assist } : {}),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', oauthStateKey()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function parseOAuthState(state: string): null | {
  tenantId: string;
  userId: string;
  platform: string;
  returnTo: string;
  expiresAt: number;
  assist?: AssistOAuthClaim;
} {
  const [body, sig] = text(state).split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', oauthStateKey()).update(body).digest('base64url');
  const suppliedBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expected);
  if (suppliedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      tenantId?: string;
      userId?: string;
      platform?: string;
      returnTo?: string;
      expiresAt?: number;
      assist?: Partial<AssistOAuthClaim>;
    };
    if (!payload.tenantId || !payload.userId || !payload.platform || !payload.expiresAt) return null;
    if (payload.expiresAt <= Date.now()) return null;
    const assist = payload.assist;
    if (assist) {
      if (
        typeof assist.linkId !== 'string'
        || !/^[A-Za-z0-9_-]{1,128}$/.test(assist.linkId)
        || typeof assist.claimNonce !== 'string'
        || !/^[A-Za-z0-9_-]{32,128}$/.test(assist.claimNonce)
        || !Number.isSafeInteger(assist.revision)
        || Number(assist.revision) < 1
        || !['meta', 'google', 'tiktok'].includes(String(assist.platform))
      ) return null;
    }
    return {
      tenantId: payload.tenantId,
      userId: payload.userId,
      platform: payload.platform,
      returnTo: payload.returnTo || '/',
      expiresAt: payload.expiresAt,
      ...(assist ? { assist: assist as AssistOAuthClaim } : {}),
    };
  } catch {
    return null;
  }
}

export function verifyMetaSignature(appSecret: string, rawBody: Buffer, signatureHeader: unknown): boolean {
  const signature = text(Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader);
  if (!signature.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const suppliedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
}

export type DeliveryNotificationSeverity = 'urgent' | 'important' | 'normal';

export interface DeliveryNotificationOptions {
  immediate?: boolean;
  tenantId?: string;
  severity?: DeliveryNotificationSeverity;
  title?: string;
  actions?: Array<{ text: string; url: string }>;
  receivers?: Array<{ name: string; channel: 'wecom' | 'dingtalk' | 'feishu' | 'sms'; target: string }>;
}

export async function notifyDeliveryTeam(message: string, options: DeliveryNotificationOptions = {}): Promise<void> {
  const enterpriseNotifications = options.tenantId
    ? await readTenantNotificationSettings(options.tenantId)
    : readEnterpriseNotificationSettings();
  const severity = options.severity ?? (options.immediate ? 'important' : 'normal');
  const immediate = options.immediate || severity === 'urgent' || severity === 'important';
  if (!immediate && enterpriseNotifications?.quietOutsideHours && !isWithinWorkHours(enterpriseNotifications.workHours)) {
    enqueueDailyBriefing(message);
    console.warn('[delivery-alert:queued-for-briefing]', message);
    return;
  }
  const tasks: Promise<unknown>[] = [];
  const selectedReceivers = options.receivers ?? enterpriseNotifications?.receivers ?? [];
  if (selectedReceivers.length) {
    for (const receiver of selectedReceivers) {
      if (receiver.channel === 'dingtalk') {
        const actionLinks = (options.actions ?? []).map(action => `[${action.text}](${action.url})`).join('　');
        tasks.push(sendDingTalkMarkdown(
          { webhookUrl: receiver.target, secret: '' },
          options.title || '灵小枢客户提醒',
          `${message.replace(/\n/g, '\n\n')}${actionLinks ? `\n\n${actionLinks}` : ''}`,
        ));
      } else if (receiver.channel === 'feishu') {
        const color = severity === 'urgent' ? 'red' : severity === 'important' ? 'yellow' : 'blue';
        tasks.push(sendFeishuCard(
          { webhookUrl: receiver.target, secret: '' },
          options.title || '灵小枢客户提醒',
          message,
          color,
          options.actions,
        ));
      } else if (receiver.channel === 'wecom' && /^https:\/\//i.test(receiver.target)) {
        const actionLinks = (options.actions ?? []).map(action => `[${action.text}](${action.url})`).join('　');
        tasks.push(sendWeComMarkdown(
          receiver.target,
          `${message}${actionLinks ? `\n${actionLinks}` : ''}`,
        ));
      } else {
        console.warn(`[delivery-alert:${receiver.channel}] ${receiver.name || receiver.target}: ${message}`);
      }
    }
    if (tasks.length) {
      const results = await Promise.allSettled(tasks);
      if (results.every(result => result.status === 'rejected')) {
        throw new Error('notification_delivery_failed');
      }
      return;
    }
    throw new Error('notification_receiver_not_deliverable');
  }
  const dingTalkWebhook = text(process.env.DELIVERY_ALERT_DINGTALK_WEBHOOK);
  if (dingTalkWebhook) {
    tasks.push(sendDingTalkText({
      webhookUrl: dingTalkWebhook,
      secret: text(process.env.DELIVERY_ALERT_DINGTALK_SECRET),
    }, message));
  }
  const feishuWebhook = text(process.env.DELIVERY_ALERT_FEISHU_WEBHOOK);
  if (feishuWebhook) {
    tasks.push(sendFeishuText({
      webhookUrl: feishuWebhook,
      secret: text(process.env.DELIVERY_ALERT_FEISHU_SECRET),
    }, message));
  }
  if (!tasks.length) {
    console.warn('[delivery-alert]', message);
    return;
  }
  const results = await Promise.allSettled(tasks);
  if (results.every(result => result.status === 'rejected')) throw new Error('notification_delivery_failed');
}

async function readTenantNotificationSettings(tenantId: string): Promise<ReturnType<typeof readEnterpriseNotificationSettings>> {
  try {
    const result = await store.list<Record<string, unknown>>('tenant_profiles', {
      where: { tenant_id: tenantId }, page: 1, perPage: 1,
    });
    const rawProfile = result.items[0]?.profile;
    const profile = typeof rawProfile === 'string' ? JSON.parse(rawProfile) : rawProfile;
    const notifications = profile && typeof profile === 'object'
      ? (profile as Record<string, any>).notifications
      : undefined;
    const receivers = Array.isArray(notifications?.receivers)
      ? notifications.receivers.map((receiver: any) => ({
          name: text(receiver?.name),
          channel: ['wecom', 'dingtalk', 'feishu', 'sms'].includes(receiver?.channel) ? receiver.channel : 'wecom',
          target: text(receiver?.target),
        })).filter((receiver: any) => receiver.target)
      : [];
    if (!receivers.length) return readEnterpriseNotificationSettings();
    return {
      receivers,
      workHours: {
        start: /^\d{2}:\d{2}$/.test(text(notifications?.workHours?.start)) ? text(notifications.workHours.start) : '09:00',
        end: /^\d{2}:\d{2}$/.test(text(notifications?.workHours?.end)) ? text(notifications.workHours.end) : '22:00',
      },
      quietOutsideHours: notifications?.quietOutsideHours !== false,
    };
  } catch {
    return readEnterpriseNotificationSettings();
  }
}

function readEnterpriseNotificationSettings(): null | {
  receivers: Array<{ name: string; channel: 'wecom' | 'dingtalk' | 'feishu' | 'sms'; target: string }>;
  workHours: { start: string; end: string };
  quietOutsideHours: boolean;
} {
  try {
    const parsed = JSON.parse(fs.readFileSync(ENTERPRISE_FILE, 'utf8'));
    const notifications = parsed?.notifications;
    const receivers = Array.isArray(notifications?.receivers)
      ? notifications.receivers.map((receiver: any) => ({
        name: text(receiver?.name),
        channel: ['wecom', 'dingtalk', 'feishu', 'sms'].includes(receiver?.channel) ? receiver.channel : 'wecom',
        target: text(receiver?.target),
      })).filter((receiver: any) => receiver.target)
      : [];
    if (!receivers.length) return null;
    return {
      receivers,
      workHours: {
        start: /^\d{2}:\d{2}$/.test(text(notifications?.workHours?.start)) ? text(notifications?.workHours?.start) : '09:00',
        end: /^\d{2}:\d{2}$/.test(text(notifications?.workHours?.end)) ? text(notifications?.workHours?.end) : '22:00',
      },
      quietOutsideHours: notifications?.quietOutsideHours !== false,
    };
  } catch {
    return null;
  }
}

function minutesOfDay(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function isWithinWorkHours(workHours: { start: string; end: string }): boolean {
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  const start = minutesOfDay(workHours.start);
  const end = minutesOfDay(workHours.end);
  if (start === end) return true;
  if (start < end) return current >= start && current <= end;
  return current >= start || current <= end;
}

function enqueueDailyBriefing(message: string): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const existing = JSON.parse(fs.existsSync(DAILY_BRIEFING_QUEUE_FILE) ? fs.readFileSync(DAILY_BRIEFING_QUEUE_FILE, 'utf8') : '[]');
    const items = Array.isArray(existing) ? existing : [];
    items.push({ id: crypto.randomUUID(), message, createdAt: new Date().toISOString(), deliverOn: nextLocalDate() });
    fs.writeFileSync(DAILY_BRIEFING_QUEUE_FILE, JSON.stringify(items, null, 2), 'utf8');
  } catch (error) {
    console.warn('[delivery-alert:queue-failed]', error);
  }
}

function nextLocalDate(): string {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  return next.toISOString().slice(0, 10);
}
