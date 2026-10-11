import { Router } from 'express';
import { decryptSecret, getTenantPlatformApp, verifyMetaSignature } from '../lib/tenantPlatformApps.js';
import { handleMessengerWebhook } from '../messenger/conversations.js';
import { handleInstagramWebhook } from '../instagram/conversations.js';
import { getInstagramLoginAccount } from '../integrations/social.js';
import { socialAccessToken } from '../lib/accountCredentials.js';
import { store } from '../storage/index.js';
import { ingestFollowupDeliveryStatuses } from '../digitalEmployees/followupDispatchWorker.js';
import { createCustomerChannelSendRequestService } from '../digitalEmployees/customerChannelSendRequests.js';
import { extractSignedCustomerChannelReceipts } from '../lib/customerChannelWebhookReceipts.js';
import { handleVerifiedWhatsAppInbound } from '../whatsapp/historyImport.js';

export const webhookRouter = Router();
const instagramMessagingIds = new Map<string, { id: string; expiresAt: number }>();

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function accountsWithInstagramMessagingIds(accounts: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  return Promise.all(accounts.map(async account => {
    if (account.oauthProvider !== 'instagram_login') return account;
    const cacheKey = `${text(account.id)}:${text(account.lastSyncAt)}`;
    const cached = instagramMessagingIds.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { ...account, instagramMessagingUserId: cached.id };
    try {
      const profile = await getInstagramLoginAccount(socialAccessToken(account), process.env.META_GRAPH_VERSION?.trim() || 'v25.0');
      if (profile.id !== text(account.providerAccountId)) throw new Error('instagram_account_identity_mismatch');
      const id = profile.userId || profile.id;
      instagramMessagingIds.set(cacheKey, { id, expiresAt: Date.now() + 60 * 60 * 1000 });
      return { ...account, instagramMessagingUserId: id };
    } catch (error) {
      console.warn('[instagram-webhook] messaging identity unavailable', error instanceof Error ? error.message : 'lookup_failed');
      return account;
    }
  }));
}

export function selectInstagramWebhookEntries(payload: any, accounts: Record<string, unknown>[]): unknown[] {
  if (!Array.isArray(payload?.entry)) return [];
  const selected: unknown[] = [];
  if (payload.object === 'instagram') {
    for (const entry of payload.entry) {
      const entryId = text(entry?.id);
      if (!entryId) continue;
      const account = accounts.find(candidate => [text(candidate.providerAccountId), text(candidate.instagramMessagingUserId)].includes(entryId));
      if (!account) continue;
      selected.push({ ...entry, id: text(account.providerAccountId), ...(text(account.instagramMessagingUserId) ? { messagingAccountId: text(account.instagramMessagingUserId) } : {}) });
    }
  } else if (payload.object === 'page') {
    for (const entry of payload.entry) {
      const pageId = text(entry?.id);
      for (const account of accounts) {
        const accountId = text(account.providerAccountId);
        if (!accountId || text(account.parentPageId) !== pageId) continue;
        const messagingAccountId = text(account.instagramMessagingUserId) || accountId;
        const messaging = Array.isArray(entry?.messaging) ? entry.messaging.filter((event: any) =>
          [accountId, messagingAccountId].includes(text(event?.sender?.id)) || [accountId, messagingAccountId].includes(text(event?.recipient?.id))) : [];
        if (messaging.length) selected.push({ id: accountId, ...(text(account.instagramMessagingUserId) ? { messagingAccountId } : {}), messaging });
      }
    }
  }
  return selected;
}

export function webhookAppPlatform(path: string, object: unknown): 'meta' | 'instagram' | null {
  if (path.startsWith('/instagram/')) return object === 'instagram' ? 'instagram' : null;
  if (object === 'instagram') return 'instagram';
  if (object === 'page' || object === 'whatsapp_business_account') return 'meta';
  return null;
}

/** Called only after HMAC validation; an app may serve several business accounts. */
export function selectWhatsAppStatusWebhookPayload(payload: any, binding: { wabaId: string; phoneNumberId: string }) {
  const entry: unknown[] = [];
  if (payload?.object !== 'whatsapp_business_account' || !binding.wabaId || !binding.phoneNumberId || !Array.isArray(payload.entry)) {
    return { object: 'whatsapp_business_account', entry };
  }
  for (const item of payload.entry) {
    if (text(item?.id) !== binding.wabaId || !Array.isArray(item.changes)) continue;
    const changes = item.changes.filter((change: any) => change?.field === 'messages'
      && text(change.value?.metadata?.phone_number_id) === binding.phoneNumberId
      && Array.isArray(change.value?.statuses)).map((change: any) => ({ field: 'messages', value: {
        metadata: { phone_number_id: binding.phoneNumberId }, statuses: change.value.statuses,
      } }));
    if (changes.length) entry.push({ id: binding.wabaId, changes });
  }
  return { object: 'whatsapp_business_account', entry };
}

export function selectWhatsAppInboundWebhookPayload(payload: any, binding: { wabaId: string; phoneNumberId: string }) {
  const entry: unknown[] = [];
  if (payload?.object !== 'whatsapp_business_account' || !binding.wabaId || !binding.phoneNumberId || !Array.isArray(payload.entry)) {
    return { object: 'whatsapp_business_account', entry };
  }
  for (const item of payload.entry) {
    if (text(item?.id) !== binding.wabaId || !Array.isArray(item.changes)) continue;
    const changes = item.changes.filter((change: any) => change?.field === 'messages'
      && text(change.value?.metadata?.phone_number_id) === binding.phoneNumberId
      && Array.isArray(change.value?.messages) && change.value.messages.length > 0).map((change: any) => ({
        field: 'messages', value: { metadata: change.value.metadata,
          contacts: Array.isArray(change.value.contacts) ? change.value.contacts : [], messages: change.value.messages },
      }));
    if (changes.length) entry.push({ id: binding.wabaId, changes });
  }
  return { object: 'whatsapp_business_account', entry };
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
    // Instagram Login uses its own OAuth secret, while an Instagram webhook
    // subscribed on the tenant's Meta app is signed by that app's secret.
    if (!signatureValid && platform === 'instagram') {
      const metaApp = await getTenantPlatformApp(tenantId, 'meta');
      const metaSecret = decryptSecret(metaApp?.app_secret);
      signatureValid = Boolean(metaApp?.app_id && metaSecret && verifyMetaSignature(metaSecret, rawBody, signatureHeader));
    }
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    res.status(403).json({ error: 'invalid_signature' });
    return;
  }

  try {
    // An app signature authenticates Meta's payload, not the tenant in our URL.
    if (req.body?.object === 'whatsapp_business_account') {
      if (app.tenant_id !== tenantId || app.platform !== 'meta' || app.status !== 'active'
        || !text(app.waba_id) || !text(app.phone_number_id)) {
        res.status(409).json({ error: 'tenant_whatsapp_binding_not_configured' });
        return;
      }
      const payload = selectWhatsAppStatusWebhookPayload(req.body, {
        wabaId: text(app.waba_id), phoneNumberId: text(app.phone_number_id),
      });
      await ingestFollowupDeliveryStatuses(tenantId, payload, { verifiedSignature: true });
      const incoming = selectWhatsAppInboundWebhookPayload(req.body, {
        wabaId: text(app.waba_id), phoneNumberId: text(app.phone_number_id),
      });
      if (incoming.entry.length) await handleVerifiedWhatsAppInbound(tenantId, incoming, {
        appId: text(app.id), wabaId: text(app.waba_id), phoneNumberId: text(app.phone_number_id),
      });
      res.json({ ok: true });
      return;
    }
    // The same app can be configured by multiple tenants, so bind each Page to
    // a connected account before it can create or update a conversation.
    const payload = req.body;
    const entries: unknown[] = [];
    const ownedPages = new Map<string, boolean>();
    const instagramAccounts = await store.list<Record<string, unknown>>('social_accounts', {
      where: { tenantId, platform: 'instagram', status: 'connected' }, page: 1, perPage: 1000,
    });
    const instagramAccountsWithMessagingIds = payload?.object === 'instagram'
      ? await accountsWithInstagramMessagingIds(instagramAccounts.items)
      : instagramAccounts.items;
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
    await handleMessengerWebhook(tenantId, { object: 'page', entry: entries }, {verifiedSignature:true});
    const instagramEntries = selectInstagramWebhookEntries(payload, instagramAccountsWithMessagingIds);
    const instagramResult = await handleInstagramWebhook(tenantId, { object: 'instagram', entry: instagramEntries });
    const receiptService = createCustomerChannelSendRequestService(store);
    for (const channel of ['messenger', 'instagram'] as const) {
      const observations = extractSignedCustomerChannelReceipts({ tenantId, channel,
        entries: channel === 'messenger' ? entries : instagramEntries,
        rawBody, verifiedSignature: true });
      for (const observation of observations) await receiptService.recordSignedChannelReceipt(observation);
    }
    if (payload?.object === 'instagram') {
      const rawEntries = Array.isArray(payload.entry) ? payload.entry : [];
      console.log('[instagram-webhook] processed', {
        rawEntries: rawEntries.length,
        matchedEntries: instagramEntries.length,
        rawMessagingEvents: rawEntries.reduce((count: number, entry: any) => count + (Array.isArray(entry?.messaging) ? entry.messaging.length : 0), 0),
        accepted: instagramResult.accepted,
      });
    }
  } catch (error) {
    console.error('[meta-webhook-ingest]', error);
    res.status(500).json({ error: 'webhook_persistence_failed' });
    return;
  }
  console.log('[meta-webhook] accepted', { tenantId });
  res.json({ ok: true });
});
