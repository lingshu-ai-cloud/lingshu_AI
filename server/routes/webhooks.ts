import { Router } from 'express';
import { decryptSecret, getTenantPlatformApp, verifyMetaSignature } from '../lib/tenantPlatformApps.js';
import { handleMessengerWebhook } from '../messenger/conversations.js';

export const webhookRouter = Router();

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

webhookRouter.get('/meta/:tenantId', async (req, res) => {
  const tenantId = text(req.params.tenantId);
  const mode = text(req.query['hub.mode']);
  const token = text(req.query['hub.verify_token']);
  const challenge = text(req.query['hub.challenge']);
  const app = await getTenantPlatformApp(tenantId, 'meta');

  if (!app?.webhook_verify_token || token !== app.webhook_verify_token || mode !== 'subscribe') {
    res.status(403).send('forbidden');
    return;
  }
  res.status(200).send(challenge);
});

webhookRouter.post('/meta/:tenantId', async (req, res) => {
  const tenantId = text(req.params.tenantId);
  const app = await getTenantPlatformApp(tenantId, 'meta');
  const appSecret = decryptSecret(app?.app_secret);
  if (!app || !appSecret) {
    res.status(404).json({ error: 'tenant_meta_app_not_configured' });
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
    await handleMessengerWebhook(tenantId, req.body);
  } catch (error) {
    console.error('[meta-webhook-ingest]', error);
    res.status(500).json({ error: 'webhook_persistence_failed' });
    return;
  }
  console.log('[meta-webhook] accepted', { tenantId });
  res.json({ ok: true });
});
