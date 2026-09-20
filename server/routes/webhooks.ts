import { Router, text as expressText, type RequestHandler } from 'express';
import { decryptSecret, getTenantPlatformApp, verifyMetaSignature } from '../lib/tenantPlatformApps.js';
import { handleMetaWebhook } from '../whatsapp/historyImport.js';
import { ingestFollowupDeliveryStatuses } from '../digitalEmployees/followupDispatchWorker.js';
import { decryptWeComEcho, verifyWeComSignature } from '../integrations/wecom.js';
import {
  weComCustomerService,
  WeComCustomerServiceError,
  type WeComCustomerService,
} from '../wecom/customerService.js';

export const webhookRouter = Router();

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

type WeComCallbackService = Pick<
  WeComCustomerService,
  'ingestCallback' | 'processCallback'
>;

export function createWeComCallbackPostHandler(input: {
  service?: WeComCallbackService;
  defer?: (work: () => void) => void;
} = {}): RequestHandler {
  const service = input.service ?? weComCustomerService;
  const defer = input.defer ?? ((work: () => void) => { setImmediate(work); });
  return async (req, res) => {
    const tenantId = text(req.params.tenantId);
    const rawXml = typeof req.body === 'string' ? req.body : '';
    if (!rawXml) {
      res.status(400).send('invalid_xml');
      return;
    }
    try {
      const ingestion = await service.ingestCallback({
        tenantId,
        signature: text(req.query.msg_signature),
        timestamp: text(req.query.timestamp),
        nonce: text(req.query.nonce),
        rawXml,
      });
      // Only acknowledge after the authenticated callback and its encrypted
      // sync token are durable. Provider I/O runs after the response.
      res.status(200).type('text/plain').send('success');
      if (ingestion.shouldProcess) {
        try {
          defer(() => {
            void service.processCallback({ tenantId, callbackId: ingestion.callbackId }).catch(error => {
              console.error('[wecom-webhook-process]', {
                tenantId,
                callbackId: ingestion.callbackId,
                code: error instanceof WeComCustomerServiceError ? error.code : 'wecom_callback_processing_failed',
              });
            });
          });
        } catch (error) {
          // Persistence already succeeded. The authenticated recovery endpoint
          // can replay the queued record even if local scheduling fails.
          console.error('[wecom-webhook-schedule]', {
            tenantId,
            callbackId: ingestion.callbackId,
            errorType: error instanceof Error ? error.name : 'UnknownError',
          });
        }
      }
    } catch (error) {
      const status = error instanceof WeComCustomerServiceError ? error.status : 503;
      const code = error instanceof WeComCustomerServiceError ? error.code : 'wecom_webhook_ingestion_failed';
      console.error('[wecom-webhook-ingest]', { tenantId, code });
      res.status(status).type('text/plain').send(code);
    }
  };
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
    await Promise.all([
      handleMetaWebhook(tenantId, req.body),
      ingestFollowupDeliveryStatuses(tenantId, req.body, { verifiedSignature: true }),
    ]);
  } catch (error) {
    console.error('[meta-webhook-ingest]', error);
    res.status(500).json({ error: 'webhook_persistence_failed' });
    return;
  }
  console.log('[meta-webhook] accepted', { tenantId });
  res.json({ ok: true });
});

webhookRouter.get('/wecom/:tenantId', async (req, res) => {
  const tenantId = text(req.params.tenantId);
  const app = await getTenantPlatformApp(tenantId, 'wecom');
  const token = text(app?.webhook_verify_token);
  const encodingAesKey = decryptSecret(app?.wecom_encoding_aes_key);
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

webhookRouter.post(
  '/wecom/:tenantId',
  expressText({ type: ['application/xml', 'text/xml', 'text/plain'], limit: '256kb' }),
  createWeComCallbackPostHandler(),
);
