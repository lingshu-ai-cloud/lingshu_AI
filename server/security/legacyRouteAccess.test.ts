import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  PB_URL: process.env.PB_URL,
  DISABLE_LOCAL_AUTH_FALLBACK: process.env.DISABLE_LOCAL_AUTH_FALLBACK,
  LOCAL_ADMIN_EMAIL: process.env.LOCAL_ADMIN_EMAIL,
  WORKBENCH_ADMIN_EMAIL: process.env.WORKBENCH_ADMIN_EMAIL,
  ADMIN_DASHBOARD_EMAILS: process.env.ADMIN_DASHBOARD_EMAILS,
  CHANNELS_DATA_FILE: process.env.CHANNELS_DATA_FILE,
};

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-legacy-route-security-'));
const channelsDataFile = path.join(temporaryDirectory, 'channels.json');
fs.writeFileSync(channelsDataFile, JSON.stringify([
  {
    id: 'known-whatsapp', type: 'whatsapp', label: 'Known WhatsApp', enabled: true, status: 'connected',
    config: { appSecret: 'legacy-meta-webhook-secret', accessToken: 'must-not-leak-access-token', phoneNumberId: 'must-not-leak-phone-id' },
    stats: { sent: 0, received: 0 },
  },
  {
    id: 'whatsapp-without-secret', type: 'whatsapp', label: 'Incomplete WhatsApp', enabled: false, status: 'disconnected',
    config: {}, stats: { sent: 0, received: 0 },
  },
  {
    id: 'known-telegram', type: 'telegram', label: 'Known Telegram', enabled: true, status: 'connected',
    config: { webhookSecret: 'telegram-secret', botToken: 'must-not-leak-bot-token' },
    stats: { sent: 0, received: 0 },
  },
], null, 2), { mode: 0o600 });

process.env.NODE_ENV = 'test';
process.env.PB_URL = 'http://127.0.0.1:1';
process.env.DISABLE_LOCAL_AUTH_FALLBACK = 'false';
process.env.LOCAL_ADMIN_EMAIL = 'route-admin@example.test';
process.env.WORKBENCH_ADMIN_EMAIL = '';
process.env.ADMIN_DASHBOARD_EMAILS = '';
process.env.CHANNELS_DATA_FILE = channelsDataFile;

const [
  {
    channelsRouter,
    publicChannel,
    verifyLegacyMetaWebhookSignature,
    verifyLegacyTelegramWebhookSecret,
  },
  { pluginsRouter },
  { copywritingRouter },
  { translationRouter },
  { competitorRouter },
  { webhookRouter },
] = await Promise.all([
  import('../routes/channels.js'),
  import('../routes/plugins.js'),
  import('../routes/copywriting.js'),
  import('../routes/translation.js'),
  import('../routes/competitor.js'),
  import('../routes/webhooks.js'),
]);

const app = express();
app.use(express.json({
  verify: (req, _res, buffer) => {
    (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
  },
}));
app.use('/channels', channelsRouter);
app.use('/plugins', pluginsRouter);
app.use('/copywriting', copywritingRouter);
app.use('/translation', translationRouter);
app.use('/competitor', competitorRouter);
app.use('/webhooks', webhookRouter);

const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('test server did not bind a TCP port');
const origin = `http://127.0.0.1:${address.port}`;

async function request(pathname: string, init?: RequestInit): Promise<{ status: number; body: string }> {
  const response = await fetch(`${origin}${pathname}`, init);
  return { status: response.status, body: await response.text() };
}

try {
  const anonymousSensitiveRequests: Array<[string, RequestInit | undefined]> = [
    ['/channels', undefined],
    ['/channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
    ['/channels/example', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
    ['/channels/example', { method: 'DELETE' }],
    ['/channels/example/test', { method: 'POST' }],
    ['/channels/example/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
    ['/plugins', undefined],
    ['/plugins/translate/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
    ['/copywriting/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
    ['/translation/single', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
    ['/competitor/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
  ];
  for (const [pathname, init] of anonymousSensitiveRequests) {
    const response = await request(pathname, init);
    assert.equal(response.status, 401, `${pathname} must reject anonymous callers before business logic`);
  }

  const ordinaryToken = `local-demo.${Buffer.from(JSON.stringify({
    userId: 'ordinary-route-test-user',
    tenantId: 'ordinary-route-test-tenant',
    email: 'ordinary-route-test@example.test',
  }), 'utf8').toString('base64url')}`;
  const authorization = { Authorization: `Bearer ${ordinaryToken}` };
  const deniedChannels = await request('/channels', { headers: authorization });
  assert.equal(deniedChannels.status, 403, 'global channel management must reject an authenticated ordinary tenant');
  const tenantPluginCatalog = await request('/plugins', { headers: authorization });
  assert.equal(tenantPluginCatalog.status, 200, 'the customer integration catalog must remain visible to an authenticated tenant');
  const tenantPlugins = JSON.parse(tenantPluginCatalog.body) as Array<Record<string, unknown>>;
  assert.ok(tenantPlugins.length > 0 && tenantPlugins.every(plugin => !('config' in plugin)));

  const adminToken = `local-demo.${Buffer.from(JSON.stringify({
    userId: 'local_user_admin_route_admin_example_test',
    tenantId: 'local_tenant_admin_route_admin_example_test',
    email: 'route-admin@example.test',
    accountType: 'admin',
    role: 'super_admin',
  }), 'utf8').toString('base64url')}`;
  const managementResponse = await request('/channels', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(managementResponse.status, 200, 'internal administrators must retain channel inventory access');
  assert.doesNotMatch(
    managementResponse.body,
    /must-not-leak|legacy-meta-webhook-secret|telegram-secret/,
    'channel inventory responses must not return raw provider credentials',
  );

  const authenticatedTranslation = await request('/plugins/translate/run', {
    method: 'POST',
    headers: { ...authorization, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(authenticatedTranslation.status, 400, 'authenticated tenant utility calls must reach validation without exposing global plugin configuration');

  const whatsappWebhook = await request('/channels/webhook/whatsapp/not-configured');
  assert.equal(whatsappWebhook.status, 404, 'public WhatsApp verification webhook must remain reachable without login');
  const telegramWebhook = await request('/channels/webhook/telegram/not-configured', { method: 'POST' });
  assert.equal(telegramWebhook.status, 404, 'unknown Telegram webhooks must not acknowledge or mutate state');
  const unknownWhatsAppPost = await request('/channels/webhook/whatsapp/not-configured', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(unknownWhatsAppPost.status, 404, 'unknown WhatsApp webhooks must not acknowledge or ingest events');

  const body = Buffer.from('{"object":"whatsapp_business_account"}');
  const secret = 'legacy-meta-webhook-secret';
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  assert.equal(verifyLegacyMetaWebhookSignature(secret, body, signature), true, 'valid Meta signatures must verify');
  assert.equal(verifyLegacyMetaWebhookSignature(secret, body, 'sha256=bad'), false, 'malformed Meta signatures must fail closed without throwing');
  assert.equal(verifyLegacyMetaWebhookSignature(secret, Buffer.from('{}'), signature), false, 'Meta signatures must bind the exact raw body');
  assert.equal(verifyLegacyTelegramWebhookSecret('telegram-secret', 'telegram-secret'), true, 'valid Telegram webhook secrets must verify');
  assert.equal(verifyLegacyTelegramWebhookSecret('telegram-secret', 'wrong-secret'), false, 'invalid Telegram webhook secrets must fail closed');

  const missingWhatsAppSecret = await request('/channels/webhook/whatsapp/whatsapp-without-secret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(missingWhatsAppSecret.status, 503, 'a configured legacy WhatsApp route without an app secret must fail closed');

  const invalidWhatsAppSignature = await request('/channels/webhook/whatsapp/known-whatsapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) },
    body: '{}',
  });
  assert.equal(invalidWhatsAppSignature.status, 403, 'a legacy WhatsApp route must reject an invalid body signature');

  const signedPayload = '{"entry":[]}';
  const signedPayloadSignature = `sha256=${createHmac('sha256', secret).update(signedPayload).digest('hex')}`;
  const validWhatsAppSignature = await request('/channels/webhook/whatsapp/known-whatsapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signedPayloadSignature },
    body: signedPayload,
  });
  assert.equal(validWhatsAppSignature.status, 200, 'a correctly signed legacy WhatsApp route must reach ingestion');

  const invalidTelegramSecret = await request('/channels/webhook/telegram/known-telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': 'wrong-secret' },
    body: '{"update_id":1}',
  });
  assert.equal(invalidTelegramSecret.status, 403, 'a legacy Telegram route must reject an invalid secret header');
  const validTelegramSecret = await request('/channels/webhook/telegram/known-telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': 'telegram-secret' },
    body: '{"update_id":1}',
  });
  assert.equal(validTelegramSecret.status, 200, 'a legacy Telegram route must accept its configured secret header');

  const storedChannels = JSON.parse(fs.readFileSync(channelsDataFile, 'utf8')) as Array<{ id: string; stats: { received: number } }>;
  assert.equal(storedChannels.find(channel => channel.id === 'known-whatsapp')?.stats.received, 1, 'only the valid WhatsApp delivery may update receipt statistics');
  assert.equal(storedChannels.find(channel => channel.id === 'known-telegram')?.stats.received, 1, 'only the valid Telegram delivery may update receipt statistics');

  const safeChannel = publicChannel({
    id: 'channel-security-fixture',
    type: 'whatsapp',
    label: 'Security fixture',
    enabled: true,
    status: 'connected',
    stats: { sent: 0, received: 0 },
    config: {
      phoneNumberId: 'phone-id',
      accessToken: 'must-not-leak-access-token',
      appSecret: 'must-not-leak-app-secret',
      verifyToken: 'must-not-leak-verify-token',
    },
  });
  const safeChannelJson = JSON.stringify(safeChannel);
  assert.equal(Object.hasOwn(safeChannel, 'config'), false, 'channel management responses must omit raw config');
  assert.doesNotMatch(safeChannelJson, /must-not-leak|phone-id/, 'channel management responses must expose presence metadata only');
  assert.deepEqual(safeChannel.configuration.secretFields, ['accessToken', 'appSecret', 'verifyToken']);

  const wecomPost = await request('/webhooks/wecom/any-tenant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"untrusted":"payload"}',
  });
  assert.equal(wecomPost.status, 501, 'incomplete WeCom ingestion must stay fail-closed outside production too');
  assert.doesNotMatch(wecomPost.body, /untrusted/, 'disabled webhook responses must not echo untrusted payloads');
  process.env.NODE_ENV = 'production';
  try {
    const productionWecomPost = await request('/webhooks/wecom/any-tenant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(productionWecomPost.status, 503, 'incomplete WeCom ingestion must be unavailable in production');
  } finally {
    process.env.NODE_ENV = 'test';
  }

  console.log('legacy route access security tests passed');
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
