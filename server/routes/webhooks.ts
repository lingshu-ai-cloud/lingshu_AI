import { Router } from 'express';
import { decryptSecret, getTenantPlatformApp, verifyMetaSignature } from '../lib/tenantPlatformApps.js';
import { handleMessengerWebhook } from '../messenger/conversations.js';
import { handleInstagramWebhook } from '../instagram/conversations.js';
import { store } from '../storage/index.js';

export const webhookRouter = Router();

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function selectInstagramWebhookEntries(payload: any, accounts: Record<string, unknown>[]): unknown[] {
  if (!Array.isArray(payload?.entry)) return [];
  const selected: unknown[] = [];
  if (payload.object === 'instagram') {
    const owned = new Set(accounts.map(account => text(account.providerAccountId)));
    for (const entry of payload.entry) if (owned.has(text(entry?.id))) selected.push(entry);
  } else if (payload.object === 'page') {
    for (const entry of payload.entry) {
      const pageId = text(entry?.id);
      for (const account of accounts) {
        const accountId = text(account.providerAccountId);
        if (!accountId || text(account.parentPageId) !== pageId) continue;
        const messaging = Array.isArray(entry?.messaging) ? entry.messaging.filter((event: any) =>
          text(event?.sender?.id) === accountId || text(event?.recipient?.id) === accountId) : [];
        if (messaging.length) selected.push({ id: accountId, messaging });
      }
    }
  }
  return selected;
}

export function webhookAppPlatform(path: string, object: unknown): 'meta' | 'instagram' | null {
  if (path.startsWith('/instagram/')) return object === 'instagram' ? 'instagram' : null;
  if (object === 'instagram') return 'instagram';
  if (object === 'page') return 'meta';
  return null;
}

webhookRouter.get(['/meta/:tenantId', '/instagram/:tenantId'], async (req, res) => {
  const tenantId = text(req.params.tenantId);
  const mode = text(req.query['hub.mode']);
  const token = text(req.query['hub.verify_token']);
  const challenge = text(req.query['hub.challenge']);
  const app = await getTenantPlatformApp(tenantId, req.path.startsWith('/instagram/') ? 'instagram' : 'meta');

  if (!app?.webhook_verify_token || token !== app.webhook_verify_token || mode !== 'subscribe') {
    res.status(403).send('forbidden');
    return;
  }
  res.status(200).send(challenge);
});

webhookRouter.post(['/meta/:tenantId', '/instagram/:tenantId'], async (req, res) => {
  const tenantId = text(req.params.tenantId);
  // object only selects which tenant-owned app secret to verify against.
  // It is untrusted until the HMAC below succeeds.
  const platform = webhookAppPlatform(req.path, req.body?.object);
  if (!platform) {
    res.status(400).json({ error: 'unsupported_webhook_object' });
    return;
  }
  const app = await getTenantPlatformApp(tenantId, platform);
  const appSecret = decryptSecret(app?.app_secret);
  if (!app || !appSecret) {
    res.status(404).json({ error: 'tenant_platform_app_not_configured' });
    return;
  }

  const rawBody = (req as any).rawBody;
  if (!(rawBody instanceof Buffer)) {
    res.status(503).json({ error: 'webhook_raw_body_unavailable' });
    return;
  }
  const signatureHeader = Array.isArray(req.headers['x-hub-signature-256'])
    ? req.headers['x-hub-signature-256'][0]
    : String(req.headers['x-hub-signature-256'] || '').trim();
  if (!/^sha256=[0-9a-f]{64}$/i.test(signatureHeader)) {
    res.status(403).json({ error: 'invalid_signature' });
    return;
  }
  let signatureValid = false;
  try {
    signatureValid = verifyMetaSignature(appSecret, rawBody, signatureHeader);
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    res.status(403).json({ error: 'invalid_signature' });
    return;
  }

  try {
    // An app signature authenticates Meta's payload, not the tenant in our URL.
    // The same app can be configured by multiple tenants, so bind each Page to
    // a connected account before it can create or update a conversation.
    const payload = req.body;
    const entries: unknown[] = [];
    const ownedPages = new Map<string, boolean>();
    const instagramAccounts = await store.list<Record<string, unknown>>('social_accounts', {
      where: { tenantId, platform: 'instagram', status: 'connected' }, page: 1, perPage: 1000,
    });
    if (payload?.object === 'page' && Array.isArray(payload.entry)) {
      for (const entry of payload.entry) {
        const pageId = text(entry?.id);
        if (!pageId) continue;
        if (!ownedPages.has(pageId)) {
          const accounts = await store.list<Record<string, unknown>>('social_accounts', {
            where: { tenantId, platform: 'facebook', status: 'connected', providerAccountId: pageId },
            page: 1, perPage: 1,
          });
          ownedPages.set(pageId, accounts.items.length > 0);
        }
        if (ownedPages.get(pageId)) entries.push(entry);
      }
    }
    await handleMessengerWebhook(tenantId, { object: 'page', entry: entries });
    await handleInstagramWebhook(tenantId, { object: 'instagram', entry: selectInstagramWebhookEntries(payload, instagramAccounts.items) });
  } catch (error) {
    console.error('[meta-webhook-ingest]', error);
    res.status(500).json({ error: 'webhook_persistence_failed' });
    return;
  }
  console.log('[meta-webhook] accepted', { tenantId });
  res.json({ ok: true });
});
