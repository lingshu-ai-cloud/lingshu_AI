import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { store } from '../storage/index.js';
import { verifyMetaSignature, type TenantPlatformAppRecord } from '../lib/tenantPlatformApps.js';
import { whatsappPlatformConfig, WHATSAPP_PLATFORM_SECRET_REF } from '../whatsapp/platformConfig.js';
import { assertVerifiedWhatsAppAssets } from '../whatsapp/assetAuthority.js';
import { selectWhatsAppInboundWebhookPayload, selectWhatsAppStatusWebhookPayload } from '../whatsapp/webhookPayload.js';
import { handleVerifiedWhatsAppInbound } from '../whatsapp/historyImport.js';
import { ingestFollowupDeliveryStatuses } from '../digitalEmployees/followupDispatchWorker.js';

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
/** Resolve the entire signed batch before side effects, rejecting ambiguous ownership. */
export async function resolveSharedWhatsAppBindings(payload: any) {
  if (payload?.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) throw Error('unsupported_webhook_object');
  const pairs = new Map<string, { wabaId: string; phoneNumberId: string }>();
  for (const entry of payload.entry) {
    if (!Array.isArray(entry?.changes)) continue;
    for (const change of entry.changes) {
      const wabaId = text(entry?.id), phoneNumberId = text(change?.value?.metadata?.phone_number_id);
      if (change?.field === 'messages' && wabaId && phoneNumberId) pairs.set(`${wabaId}:${phoneNumberId}`, { wabaId, phoneNumberId });
    }
  }
  const config = whatsappPlatformConfig();
  const bindings: TenantPlatformAppRecord[] = [];
  for (const pair of pairs.values()) {
    const result = await store.list<TenantPlatformAppRecord>('tenant_platform_apps', {
      where: { platform: 'meta', waba_id: pair.wabaId, phone_number_id: pair.phoneNumberId }, perPage: 2,
    });
    if (result.totalItems !== result.items.length || result.totalItems > 1 || result.items.length > 1) throw Error('whatsapp_webhook_binding_ambiguous');
    const app = result.items[0];
    if (!app || app.status !== 'active' || app.app_id !== config.appId || app.app_secret !== WHATSAPP_PLATFORM_SECRET_REF) continue;
    assertVerifiedWhatsAppAssets(app);
    if (!app.tenant_id || !app.id) throw Error('whatsapp_webhook_binding_invalid');
    bindings.push(app);
  }
  return bindings;
}

export const sharedWhatsAppWebhookRouter = Router();
sharedWhatsAppWebhookRouter.get('/', (req, res) => {
  const config = whatsappPlatformConfig(), token = text(req.query['hub.verify_token']);
  if (!config.configured) { res.status(503).send('whatsapp_platform_not_configured'); return; }
  if (req.query['hub.mode'] !== 'subscribe' || Buffer.byteLength(token) !== Buffer.byteLength(config.verifyToken)
    || !timingSafeEqual(Buffer.from(token), Buffer.from(config.verifyToken))) { res.status(403).send('forbidden'); return; }
  res.status(200).send(text(req.query['hub.challenge']));
});
sharedWhatsAppWebhookRouter.post('/', async (req, res) => {
  const config = whatsappPlatformConfig();
  if (!config.configured) { res.status(503).json({ error: 'whatsapp_platform_not_configured' }); return; }
  const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody;
  if (!Buffer.isBuffer(rawBody)) { res.status(503).json({ error: 'webhook_raw_body_unavailable' }); return; }
  const signature = text(req.headers['x-hub-signature-256']);
  if (!/^sha256=[0-9a-f]{64}$/i.test(signature) || !verifyMetaSignature(config.appSecret, rawBody, signature)) {
    res.status(403).json({ error: 'invalid_signature' }); return;
  }
  try {
    const bindings = await resolveSharedWhatsAppBindings(req.body);
    for (const app of bindings) {
      // Re-read before delivery; a locally disconnected account cannot inherit this batch.
      const current = await store.getById<TenantPlatformAppRecord>('tenant_platform_apps', app.id);
      if (!current || current.status !== 'active' || current.last_checklist !== app.last_checklist) throw Error('whatsapp_webhook_binding_changed');
      assertVerifiedWhatsAppAssets(current);
      const binding = { wabaId: app.waba_id!, phoneNumberId: app.phone_number_id! };
      await ingestFollowupDeliveryStatuses(app.tenant_id, selectWhatsAppStatusWebhookPayload(req.body, binding), { verifiedSignature: true });
      const incoming = selectWhatsAppInboundWebhookPayload(req.body, binding);
      if (incoming.entry.length) await handleVerifiedWhatsAppInbound(app.tenant_id, incoming, { appId: app.id, ...binding });
    }
    res.json({ ok: true });
  } catch { res.status(503).json({ error: 'whatsapp_webhook_processing_failed' }); }
});
