import { Router, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getBotInfo, sendTelegramMessage } from '../integrations/telegram.js';
import { testDingTalk } from '../integrations/dingtalk.js';
import { testFeishu } from '../integrations/feishu.js';
import { getShopInfo, testShopify } from '../integrations/shopify.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { adminUserForHttp, requireInternalAdmin } from '../lib/demoAccounts.js';
import {
  getTenantPlatformApp,
  verifyMetaSignature,
  type TenantPlatformAppRecord,
  type TenantPlatformStatus,
} from '../lib/tenantPlatformApps.js';
import { store } from '../storage/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.NODE_ENV === 'test' && process.env.CHANNELS_DATA_FILE
  ? path.resolve(process.env.CHANNELS_DATA_FILE)
  : path.join(__dirname, '../../data/channels.json');

export interface Channel {
  id: string;
  type: 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'messenger' | 'telegram' | 'dingtalk' | 'feishu' | 'wechat' | 'shopify';
  label: string;
  enabled: boolean;
  config: Record<string, string>;
  status: 'connected' | 'disconnected' | 'error';
  connectedAt?: string;
  lastActivity?: string;
  stats: { sent: number; received: number };
}

export interface PublicChannel extends Omit<Channel, 'config'> {
  configuration: {
    configuredFields: string[];
    secretFields: string[];
  };
}

const SECRET_CONFIG_FIELD = /(secret|token|password|api.?key|private.?key|credential|authorization)/i;

/**
 * The legacy channel store contains plaintext provider credentials. Even an
 * internal management response must expose only presence metadata, never the
 * raw configuration object.
 */
export function publicChannel(channel: Channel): PublicChannel {
  const configuredFields = Object.entries(channel.config || {})
    .filter(([, value]) => String(value || '').trim())
    .map(([key]) => key)
    .sort();
  return {
    id: channel.id,
    type: channel.type,
    label: channel.label,
    enabled: channel.enabled,
    status: channel.status,
    ...(channel.connectedAt ? { connectedAt: channel.connectedAt } : {}),
    ...(channel.lastActivity ? { lastActivity: channel.lastActivity } : {}),
    stats: channel.stats,
    configuration: {
      configuredFields,
      secretFields: configuredFields.filter(key => SECRET_CONFIG_FIELD.test(key)),
    },
  };
}

function headerText(value: unknown): string {
  return String(Array.isArray(value) ? value[0] : value || '').trim();
}

function safeSecretEqual(expected: string, provided: unknown): boolean {
  const supplied = headerText(provided);
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return Boolean(expected)
    && expectedBuffer.length === suppliedBuffer.length
    && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export function verifyLegacyMetaWebhookSignature(
  appSecret: string,
  rawBody: Buffer,
  signatureHeader: unknown,
): boolean {
  const header = headerText(signatureHeader);
  // Guard verifyMetaSignature from malformed-length timingSafeEqual inputs.
  if (!appSecret || !/^sha256=[0-9a-f]{64}$/i.test(header)) return false;
  try {
    return verifyMetaSignature(appSecret, rawBody, header);
  } catch {
    return false;
  }
}

export function verifyLegacyTelegramWebhookSecret(expected: string, header: unknown): boolean {
  return safeSecretEqual(expected, header);
}

function load(): Channel[] {
  try { return JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch { return []; }
}
function save(channels: Channel[]) {
  fs.writeFileSync(DATA, JSON.stringify(channels, null, 2));
}

export const channelsRouter = Router();

type TenantChannelStatus = 'advisor_configuring' | 'waiting_customer' | 'importing' | 'connected' | 'needs_service';

const USER_CHANNELS = [
  { id: 'messenger', name: 'Messenger', platform: 'meta' as const, oauth: true },
  { id: 'instagram', name: 'Instagram', platform: 'meta' as const, oauth: true },
  { id: 'facebook', name: 'Facebook', platform: 'meta' as const, oauth: true },
  { id: 'youtube', name: 'YouTube', platform: 'google' as const, oauth: true },
] as const;

function tenantStatus(status?: TenantPlatformStatus): TenantChannelStatus {
  if (status === 'active') return 'connected';
  if (status === 'waiting_customer') return 'waiting_customer';
  if (status === 'importing_history' || status === 'verifying') return 'importing';
  if (status === 'token_expired' || status === 'error' || status === 'needs_permanent_token') return 'needs_service';
  return 'advisor_configuring';
}

function lastCheckedAt(app: TenantPlatformAppRecord | null): string | null {
  if (!app) return null;
  const record = app as TenantPlatformAppRecord & { updated?: string; updatedAt?: string; created?: string; createdAt?: string };
  return record.updated || record.updatedAt || record.created || record.createdAt || null;
}

channelsRouter.get('/status', requireAuth, async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const admin = await adminUserForHttp(req, res);
  if (admin === undefined) return;
  const isAdmin = Boolean(admin);
  const metaApp = await getTenantPlatformApp(tenantId, 'meta');
  const googleApp = await getTenantPlatformApp(tenantId, 'google');
  const platformApps = { meta: metaApp, google: googleApp };
  const [youtubeAccounts, socialAccounts] = await Promise.all([
    store.list<Record<string, unknown>>('youtube_accounts', {
      where: { tenantId, status: 'connected' }, page: 1, perPage: 10,
    }).then(result => result.items).catch(() => []),
    store.list<Record<string, unknown>>('social_accounts', {
      where: { tenantId, status: 'connected' }, page: 1, perPage: 50,
    }).then(result => result.items).catch(() => []),
  ]);
  const connectedSocialPlatforms = new Set(socialAccounts.map(account => String(account.platform || '')));

  res.json({
    isAdmin,
    channels: USER_CHANNELS.map(channel => {
      const app = platformApps[channel.platform];
      const hasConnectedAccount = channel.id === 'youtube'
        ? youtubeAccounts.length > 0
        : channel.id === 'messenger'
          ? socialAccounts.some(account => account.platform === 'facebook' && account.messengerSubscribed === true)
        : channel.id === 'facebook' || channel.id === 'instagram'
          ? connectedSocialPlatforms.has(channel.id)
          : false;
      const status = hasConnectedAccount ? 'connected' : tenantStatus(app?.status);
      return {
        id: channel.id,
        name: channel.name,
        oauth: channel.oauth,
        status,
        lastCheckedAt: lastCheckedAt(app),
        needsAuthorization: status === 'waiting_customer',
      };
    }),
  });
});

channelsRouter.get('/', requireAuth, requireInternalAdmin, (_req, res) => res.json(load().map(publicChannel)));

channelsRouter.post('/', requireAuth, requireInternalAdmin, (req: Request, res: Response) => {
  const channels = load();
  const channel: Channel = {
    id: `ch_${Date.now()}`,
    type: req.body.type,
    label: req.body.label ?? req.body.type,
    enabled: false,
    config: req.body.config ?? {},
    status: 'disconnected',
    stats: { sent: 0, received: 0 },
  };
  channels.push(channel);
  save(channels);
  res.json(publicChannel(channel));
});

channelsRouter.put('/:id', requireAuth, requireInternalAdmin, (req: Request, res: Response) => {
  const channels = load();
  const idx = channels.findIndex(c => c.id === req.params.id);
  if (idx === -1) { res.status(404).json({ error: 'not found' }); return; }
  channels[idx] = { ...channels[idx], ...req.body };
  save(channels);
  res.json(publicChannel(channels[idx]));
});

channelsRouter.delete('/:id', requireAuth, requireInternalAdmin, (req: Request, res: Response) => {
  const channels = load().filter(c => c.id !== req.params.id);
  save(channels);
  res.json({ ok: true });
});

// Test connection
channelsRouter.post('/:id/test', requireAuth, requireInternalAdmin, async (req: Request, res: Response) => {
  const channel = load().find(c => c.id === req.params.id);
  if (!channel) { res.status(404).json({ error: 'not found' }); return; }
  const cfg = channel.config;

  try {
    switch (channel.type) {
      case 'telegram': {
        const info = await getBotInfo({ botToken: cfg.botToken });
        res.json({ ok: true, info });
        break;
      }
      case 'dingtalk': {
        const ok = await testDingTalk({ webhookUrl: cfg.webhookUrl, secret: cfg.secret });
        res.json({ ok });
        break;
      }
      case 'feishu': {
        const ok = await testFeishu({ webhookUrl: cfg.webhookUrl, secret: cfg.secret });
        res.json({ ok });
        break;
      }
      case 'shopify': {
        const result = await testShopify(cfg as any);
        res.json(result);
        break;
      }
      case 'youtube':
      case 'tiktok':
      case 'instagram':
      case 'facebook':
        res.status(501).json({ ok: false, error: '该渠道尚未实现真实连接测试' });
        return;
        break;
      default:
        res.json({ ok: false, error: 'unsupported' });
    }

    // Update status on success
    const channels = load();
    const idx = channels.findIndex(c => c.id === req.params.id);
    if (idx !== -1) {
      channels[idx].status = 'connected';
      channels[idx].connectedAt = new Date().toISOString();
      channels[idx].enabled = true;
      save(channels);
    }
  } catch (err: any) {
    const channels = load();
    const idx = channels.findIndex(c => c.id === req.params.id);
    if (idx !== -1) { channels[idx].status = 'error'; save(channels); }
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Send message via channel
channelsRouter.post('/:id/send', requireAuth, requireInternalAdmin, async (req: Request, res: Response) => {
  const channel = load().find(c => c.id === req.params.id);
  if (!channel) { res.status(404).json({ error: 'not found' }); return; }
  const { to, text } = req.body;
  const cfg = channel.config;

  try {
    switch (channel.type) {
      case 'telegram':
        await sendTelegramMessage({ botToken: cfg.botToken }, to ?? cfg.defaultChatId, text);
        break;
      default:
        res.status(400).json({ error: 'send not supported for this channel' }); return;
    }
    const channels = load();
    const idx = channels.findIndex(c => c.id === req.params.id);
    if (idx !== -1) { channels[idx].stats.sent++; channels[idx].lastActivity = new Date().toISOString(); save(channels); }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Telegram webhook receive
channelsRouter.post('/webhook/telegram/:id', (req: Request, res: Response) => {
  const channels = load();
  const idx = channels.findIndex(c => c.id === req.params.id && c.type === 'telegram');
  if (idx === -1) { res.status(404).send('Not found'); return; }
  const webhookSecret = String(channels[idx].config.webhookSecret || channels[idx].config.secretToken || '').trim();
  if (!webhookSecret) {
    res.status(503).json({ error: 'legacy_webhook_secret_not_configured' });
    return;
  }
  if (!verifyLegacyTelegramWebhookSecret(webhookSecret, req.headers['x-telegram-bot-api-secret-token'])) {
    res.status(403).json({ error: 'invalid_webhook_secret' });
    return;
  }
  channels[idx].stats.received++;
  channels[idx].lastActivity = new Date().toISOString();
  save(channels);
  // TODO: route message to agent
  res.sendStatus(200);
});
