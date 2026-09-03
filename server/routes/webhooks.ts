import { Router } from 'express';
import { getTenantPlatformApp, verifyMetaSignature } from '../lib/tenantPlatformApps.js';
import { tenantPlatformSecret } from '../security/platformCredentials.js';
import { handleMetaWebhook } from '../whatsapp/historyImport.js';
import { decryptWeComEcho, verifyWeComSignature } from '../integrations/wecom.js';
import { verifyMetaWebhookVerifyToken } from '../security/webhookCredentials.js';

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

  if (!app?.webhook_verify_token || !verifyMetaWebhookVerifyToken(app.webhook_verify_token, token) || mode !== 'subscribe') {
    res.status(403).send('forbidden');
    return;
  }
  res.status(200).send(challenge);
});

webhookRouter.post('/meta/:tenantId', async (req, res) => {
  const tenantId = text(req.params.tenantId);
  const app = await getTenantPlatformApp(tenantId, 'meta');
  const appSecret = app ? tenantPlatformSecret(app, 'app_secret') : '';
  if (!app || !appSecret) {
    res.status(404).json({ error: 'tenant_meta_app_not_configured' });
    return;
  }

  const rawBody = (req as { rawBody?: unknown }).rawBody;
  if (!Buffer.isBuffer(rawBody)) {
    res.status(400).json({ error: 'raw_body_unavailable' });
    return;
  }
  if (!verifyMetaSignature(appSecret, rawBody, req.headers['x-hub-signature-256'])) {
    res.status(403).json({ error: 'invalid_signature' });
    return;
  }

  try {
    // Acknowledge only after each provider message has a durable receipt and
    // processing has completed (or is durably fenced for reconciliation).
    await handleMetaWebhook(tenantId, req.body);
    console.info('[meta-webhook-accepted]', tenantId);
    res.json({ ok: true });
  } catch (error) {
    // Do not log request bodies, provider payloads, customer text, or tokens.
    console.error('[meta-webhook-ingest]', error instanceof Error ? error.name : 'unknown_error');
    res.status(503).json({ error: 'webhook_processing_unavailable' });
  }
});

webhookRouter.get('/wecom/:tenantId', async (req, res) => {
  const tenantId = text(req.params.tenantId);
  const app = await getTenantPlatformApp(tenantId, 'wecom');
  const token = app ? tenantPlatformSecret(app, 'webhook_verify_token') : '';
  const encodingAesKey = app ? tenantPlatformSecret(app, 'wecom_encoding_aes_key') : '';
  const signature = text(req.query.msg_signature);
  const timestamp = text(req.query.timestamp);
  const nonce = text(req.query.nonce);
  const echostr = text(req.query.echostr);

  if (!app || !token || !encodingAesKey || !signature || !timestamp || !nonce || !echostr) {
    res.status(403).send('forbidden');
    return;
  }
  if (!verifyWeComSignature({ token, timestamp, nonce, encrypted: echostr, signature })) {
    res.status(403).send('invalid_signature');
    return;
  }

  try {
    res.status(200).send(decryptWeComEcho({
      encodingAesKey,
      encryptedEcho: echostr,
      corpId: text(app.app_id),
    }));
  } catch (error) {
    console.error('[wecom-webhook-verify]', error);
    res.status(400).send('decrypt_failed');
  }
});

webhookRouter.post('/wecom/:tenantId', async (req, res) => {
  // Receiving encrypted WeCom events without authenticating msg_signature,
  // decrypting the XML and validating corpId would acknowledge forged or lost
  // messages. Keep this capability explicitly unavailable until its complete
  // ingest pipeline is enabled; GET verification remains fully authenticated.
  res.status(501).json({ error: 'wecom_encrypted_event_ingest_not_enabled' });
});
