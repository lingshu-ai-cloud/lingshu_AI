import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';

// This is an isolated persistence/authentication gate. Real Meta delivery is
// verified separately; this harness never contacts Meta or sends a message.
const repo = path.resolve(import.meta.dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-messenger-release-'));
const pbBin = process.env.PB_BIN || path.join(os.homedir(), '.local/share/lingshu/pocketbase/pocketbase');
const adminEmail = 'messenger-release@example.invalid';
const adminPassword = randomBytes(24).toString('hex');
const dataDir = path.join(root, 'pb');
const migrationsDir = path.join(repo, 'pb_migrations');
let pb: ChildProcess | undefined;
let server: ReturnType<typeof express.application.listen> | undefined;

async function freePort() {
  const socket = net.createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as AddressInfo).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  return port;
}

try {
  assert.ok(fs.existsSync(pbBin), 'Set PB_BIN to the official PocketBase executable');
  for (const args of [
    ['migrate', 'up', `--dir=${dataDir}`, `--migrationsDir=${migrationsDir}`],
    ['superuser', 'upsert', adminEmail, adminPassword, `--dir=${dataDir}`],
  ]) {
    const result = spawnSync(pbBin, args, { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, `PocketBase ${args[0]} failed: ${result.stderr}`);
  }
  const pbUrl = `http://127.0.0.1:${await freePort()}`;
  pb = spawn(pbBin, ['serve', `--http=${new URL(pbUrl).host}`, `--dir=${dataDir}`, `--migrationsDir=${migrationsDir}`, '--automigrate=false'], { cwd: repo, stdio: 'ignore' });
  let healthy = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { healthy = (await fetch(`${pbUrl}/api/health`, { signal: AbortSignal.timeout(500) })).ok; } catch { /* startup */ }
    if (healthy) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(healthy, 'isolated PocketBase must become healthy');
  Object.assign(process.env, {
    NODE_ENV: 'production', PB_URL: pbUrl, PB_ADMIN_EMAIL: adminEmail, PB_ADMIN_PASSWORD: adminPassword,
    ENABLE_LOCAL_DEV_FALLBACK: 'false', DISABLE_LOCAL_AUTH_FALLBACK: 'true',
    TENANT_PLATFORM_APP_KEY: randomBytes(32).toString('base64'),
    PRODUCT_API_KEY_PEPPER: randomBytes(32).toString('base64'),
    MESSENGER_CUSTOMERS_DATA_FILE: path.join(root, 'customers.json'),
    LOCAL_STORE_DIR: path.join(root, 'forbidden-local-fallback'),
    QUOTE_SKILL_ENABLED: 'true', QUOTE_SKILL_TENANT_ALLOWLIST: '',
  });
  // Do not transmit synthetic customer content to a configured model provider.
  for (const key of ['QWEN_API_KEY', 'DASHSCOPE_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY']) delete process.env[key];
  const [{ store }, apps, { dataAuthorityRequestScope }, { webhookRouter }, { customerSuggestionsRouter }, { createQuoteSkillRouter }] = await Promise.all([
    import('../server/storage/index.js'), import('../server/lib/tenantPlatformApps.js'),
    import('../server/storage/dataAuthority.js'), import('../server/routes/webhooks.js'),
    import('../server/routes/customerSuggestions.js'), import('../server/routes/quoteSkill.js'),
  ]);
  const adminAuth = await fetch(`${pbUrl}/api/collections/_superusers/auth-with-password`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: adminEmail, password: adminPassword }),
  });
  assert.equal(adminAuth.status, 200);
  const adminToken = String((await adminAuth.json() as { token: string }).token);
  async function user(tenantId: string) {
    const email = `${tenantId}@example.invalid`;
    const password = randomBytes(24).toString('hex');
    const created = await fetch(`${pbUrl}/api/collections/users/records`, {
      method: 'POST', headers: { authorization: adminToken, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, passwordConfirm: password, verified: true, tenantId }),
    });
    assert.equal(created.status, 200, 'real PocketBase test user must persist');
    const login = await fetch(`${pbUrl}/api/collections/users/auth-with-password`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password }),
    });
    assert.equal(login.status, 200);
    return String((await login.json() as { token: string }).token);
  }
  const tokenA = await user('messenger-release-a');
  const tokenB = await user('messenger-release-b');
  const secret = randomBytes(24).toString('hex');
  const verify = randomBytes(24).toString('hex');
  await apps.upsertTenantPlatformApp({ tenantId: 'messenger-release-a', platform: 'meta', appId: '123456789', appSecret: secret, webhookVerifyToken: verify });
  const appRecord = await apps.getTenantPlatformApp('messenger-release-a', 'meta');
  assert.ok(appRecord?.app_secret?.startsWith('v1:'));
  assert.notEqual(appRecord.app_secret, secret);
  assert.equal(apps.decryptSecret(appRecord.app_secret), secret);
  assert.equal(await apps.getTenantPlatformApp('messenger-release-b', 'meta'), null);
  await apps.upsertTenantPlatformApp({ tenantId: 'messenger-release-b', platform: 'meta', appId: '123456789', appSecret: secret });
  const pageAccount = await store.create('social_accounts', {
    tenantId: 'messenger-release-a', platform: 'facebook', status: 'connected',
    providerAccountId: 'release-page', title: 'Isolated release Page', accessToken: apps.encryptSecret('synthetic-page-token'),
  });
  assert.ok(pageAccount?.id);

  const app = express();
  app.use(dataAuthorityRequestScope);
  app.use(express.json({ verify: (req, _res, buffer) => { (req as any).rawBody = Buffer.from(buffer); } }));
  app.use('/api/webhooks', webhookRouter);
  app.use('/api/overseas/customers', customerSuggestionsRouter);
  app.use('/api/overseas/quote-skill', createQuoteSkillRouter({
    readEnterpriseProfile: (async () => ({
      company: { name: 'Isolated test factory' },
      products: { items: [{ sku: 'IMH-ABS-01', name: 'ABS housing', material: 'ABS', moq: '1000', attributes: { unit: 'pcs', unitPrice: 3.8, currency: 'USD', leadTime: '30 days' } }] },
      bizRules: { quoteMode: 'reference_range', paymentTerms: '30% deposit, balance before shipment' },
    })) as any,
  }));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server!.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  async function api(token: string, route: string, method = 'GET', body?: unknown) {
    const response = await fetch(`${base}/api/overseas${route}`, { method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  }
  assert.equal((await api('invalid', '/customers')).status, 401);
  const challenge = await fetch(`${base}/api/webhooks/meta/messenger-release-a?${new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': verify, 'hub.challenge': 'release-challenge' })}`);
  assert.equal(challenge.status, 200);
  assert.equal(await challenge.text(), 'release-challenge');
  assert.equal((await fetch(`${base}/api/webhooks/meta/messenger-release-a?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x`)).status, 403);
  const payload = JSON.stringify({ object: 'page', entry: [{ id: 'release-page', messaging: [{
    sender: { id: 'release-buyer' }, recipient: { id: 'release-page' }, timestamp: Date.now(),
    message: { mid: 'release-message-1', text: 'Please quote 1500 pcs of SKU IMH-ABS-01 in ABS. Budget USD 6000. Destination Germany. The named FOB port still needs confirmation.' },
  }] }] });
  const signature = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
  async function webhook(signatureHeader: string) {
    return fetch(`${base}/api/webhooks/meta/messenger-release-a`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signatureHeader }, body: payload,
    });
  }
  assert.equal((await webhook(`sha256=${'0'.repeat(64)}`)).status, 403);
  assert.equal((await webhook('sha256=malformed')).status, 403);
  assert.equal((await webhook(signature)).status, 200);
  assert.equal((await webhook(signature)).status, 200);
  const misrouted = await fetch(`${base}/api/webhooks/meta/messenger-release-b`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, body: payload,
  });
  assert.equal(misrouted.status, 200, 'unknown Page events are acknowledged without persisting them');
  const inbox = await api(tokenA, '/customers');
  assert.equal(inbox.status, 200);
  assert.equal(inbox.body.items.length, 1);
  const customer = inbox.body.items[0];
  assert.equal(customer.timeline.length, 1, 'provider retry must remain idempotent');
  assert.equal((await api(tokenB, '/customers')).body.items.length, 0);
  assert.equal((await api(tokenB, `/customers/${customer.id}`, 'PATCH', { name: 'cross-tenant' })).status, 404);
  const snapshot = fs.readFileSync(process.env.MESSENGER_CUSTOMERS_DATA_FILE!, 'utf8');
  fs.writeFileSync(process.env.MESSENGER_CUSTOMERS_DATA_FILE!, '{corrupt');
  assert.equal((await webhook(signature)).status, 500, 'failed persistence must request a provider retry');
  assert.equal(fs.readFileSync(process.env.MESSENGER_CUSTOMERS_DATA_FILE!, 'utf8'), '{corrupt');
  fs.writeFileSync(process.env.MESSENGER_CUSTOMERS_DATA_FILE!, snapshot);
  assert.equal((await webhook(signature)).status, 200);
  assert.equal((await api(tokenA, '/customers')).body.items[0].timeline.length, 1);
  const reread = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    'const {getMessengerCustomers}=await import("./server/messenger/conversations.ts"); console.log(getMessengerCustomers("messenger-release-a")[0].timeline.length);',
  ], { cwd: repo, env: process.env, encoding: 'utf8' });
  assert.equal(reread.status, 0, 'a fresh process must read the persisted inbox');
  assert.equal(reread.stdout.trim(), '1');
  const draftResponse = await api(tokenA, '/quote-skill/drafts', 'POST', {
    customerId: customer.id, customerLanguage: 'English', messages: customer.timeline.map((event: any) => event.body),
  });
  assert.equal(draftResponse.status, 201, JSON.stringify(draftResponse.body));
  const draft = draftResponse.body.draft;
  assert.equal(draft.quantity, 1500);
  assert.equal(draft.subtotal, 5700);
  assert.equal(draft.status, 'needs_clarification');
  assert.ok(draft.blockers.some((blocker: string) => blocker.includes('FOB')));
  assert.ok(draft.clarificationQuestions.some((question: string) => question.includes('FOB')), 'normalizing a persisted quote must preserve its port clarification');
  const persisted = await store.getById<any>('quote_skill_drafts', draft.id);
  assert.equal(persisted?.tenant_id, 'messenger-release-a');
  assert.equal((await api(tokenB, `/quote-skill/customers/${customer.id}/latest`)).body.draft, null);
  await store.update('social_accounts', pageAccount!.id, { status: 'disconnected' });
  const disconnectedPayload = payload.replace('release-message-1', 'release-message-after-disconnect');
  const disconnected = await fetch(`${base}/api/webhooks/meta/messenger-release-a`, {
    method: 'POST', headers: { 'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(disconnectedPayload).digest('hex')}` }, body: disconnectedPayload,
  });
  assert.equal(disconnected.status, 200);
  assert.equal((await api(tokenA, '/customers')).body.items[0].timeline.length, 1, 'disconnected Pages cannot ingest new messages');
  assert.ok(!fs.existsSync(process.env.LOCAL_STORE_DIR!), 'production must never persist fallback records');
  console.log('Messenger production gate passed: real PocketBase user auth, encrypted app credentials, signed callback/retry, tenant isolation and durable quote draft. Synthetic messages/catalog only; no external message sent.');
} finally {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  if (pb && pb.exitCode === null) {
    pb.kill('SIGTERM');
    await new Promise<void>(resolve => pb!.once('exit', () => resolve()));
  }
  fs.rmSync(root, { recursive: true, force: true });
}
