import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import axios from 'axios';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
process.env.NODE_ENV = 'test';
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
process.env.TEST_ONLY_EXTERNAL_EFFECT_LEASE_FALLBACK = 'true';
const [{ store }, { mountWhatsAppOAuthRoutes }, { webhookRouter }, { resolveSharedWhatsAppBindings },
  { issueLocalIdentityTokenForTest }, { decryptSecret }, { assertVerifiedWhatsAppAssets }, { resolveTenantWhatsAppConfig }] = await Promise.all([
  import('../storage/index.js'), import('../routes/whatsappParentMount.js'), import('../routes/webhooks.js'),
  import('../routes/whatsappSharedWebhook.js'), import('../auth/localIdentity.js'), import('../lib/tenantPlatformApps.js'),
  import('./assetAuthority.js'), import('./send.js'),
]);
import { platformIntegrationsRouter } from '../routes/platformIntegrations.js';
import type { Record_ } from '../storage/datastore.js';
import type { TenantPlatformAppRecord } from '../lib/tenantPlatformApps.js';

test('one platform app: independent tenant signup, replay/role gates, signed batch routing, disconnection and secret rotation', async () => {
  const original = { ...store }, oldGet = axios.get, oldPost = axios.post, oldConnect = Socket.prototype.connect;
  const env = { ...process.env };
  Object.assign(process.env, { WHATSAPP_PLATFORM_APP_ID: '999', WHATSAPP_PLATFORM_APP_SECRET: 'shared-secret',
    WHATSAPP_PLATFORM_CONFIG_ID: '888', WHATSAPP_PLATFORM_VERIFY_TOKEN: 'shared-verify', TENANT_PLATFORM_APP_KEY: 'test-encryption-key' });
  const rows: Record<string, Record_[]> = {}, providerCalls: string[] = [], readTenants: string[] = [];
  let serial = 0, codeExpires = false, phoneConnected = true, subscriptionSucceeds = true, tokenValid = true, paginated = false, revokeDuringSubscription = false;
  store.supportsAtomicOperationLease = () => true;
  store.supportsAtomicCompareAndSwap = () => true;
  store.list = async <T>(collection: string, query: any = {}) => {
    if (collection === 'followup_batch_items') readTenants.push(query.where.tenant_id);
    const matches = (rows[collection] || []).filter(row => Object.entries(query.where || {}).every(([k, v]) => row[k] === v));
    const page = query.page || 1, perPage = query.perPage || 20;
    return { items: structuredClone(matches.slice((page - 1) * perPage, page * perPage)) as T[],
      totalItems: matches.length, totalPages: Math.ceil(matches.length / perPage), page, perPage };
  };
  store.getById = async <T>(collection: string, id: string) => structuredClone((rows[collection] || []).find(row => row.id === id) || null) as T | null;
  store.create = async <T>(collection: string, patch: Record<string, unknown>) => {
    const items = rows[collection] ||= [];
    if (items.some(row => row.id === patch.id || (collection === 'durable_operation_leases'
      && row.tenant_id === patch.tenant_id && row.lease_scope === patch.lease_scope && row.subject_id === patch.subject_id))) return null;
    const row = { ...structuredClone(patch), id: String(patch.id || `row-${++serial}`) };
    items.push(row); return structuredClone(row) as T;
  };
  store.update = async (collection, id, patch) => {
    const row = rows[collection]?.find(item => item.id === id); if (!row) return false; Object.assign(row, structuredClone(patch)); return true;
  };
  store.compareAndSwap = async (collection, id, expected, patch) => {
    const row = rows[collection]?.find(item => item.id === id);
    if (!row || !Object.entries(expected).every(([key, value]) => JSON.stringify(row[key]) === JSON.stringify(value))) return false;
    Object.assign(row, structuredClone(patch)); return true;
  };
  store.delete = async (collection, id) => {
    const items = rows[collection] || [], index = items.findIndex(row => row.id === id);
    if (index < 0) return false; items.splice(index, 1); return true;
  };
  Socket.prototype.connect = function () { throw Error('external_network_forbidden'); };
  axios.get = (async (url: string, options: any) => {
    providerCalls.push(url); assert.equal(options.maxRedirects, 0);
    if (url.endsWith('/oauth/access_token')) return { data: { access_token: `token-${options.params.code}` } };
    if (url.endsWith('/debug_token')) return { data: { data: { is_valid: tokenValid, app_id: '999', expires_at: codeExpires ? 1 : 0,
      scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'] } } };
    if (url.endsWith('/phone_numbers') && paginated && !options.params?.after) return { data: { data: [], paging: { next: 'https://untrusted.example/never-follow', cursors: { after: 'safe-cursor' } } } };
    if (url.endsWith('/phone_numbers')) return { data: { data: [{ id: String(Number(url.split('/').at(-2)) + 1) }] } };
    const id = url.split('/').at(-1);
    return { data: { id, status: phoneConnected ? 'CONNECTED' : 'PENDING', display_phone_number: id === '101' ? '+15550000101' : '+15550000201' } };
  }) as typeof axios.get;
  axios.post = (async (url: string, _body: unknown, options: any) => {
    providerCalls.push(url); assert.equal(options.maxRedirects, 0); assert.ok(url.endsWith('/subscribed_apps'));
    if (revokeDuringSubscription) rows.tenant_platform_apps!.find(row => row.tenant_id === 'a')!.status = 'pending';
    return { data: { success: subscriptionSucceeds } };
  }) as typeof axios.post;
  const app = express();
  app.use(express.json({ verify(req, _res, bytes) { (req as any).rawBody = Buffer.from(bytes); } }));
  mountWhatsAppOAuthRoutes(app); app.use('/api/webhooks', webhookRouter); app.use('/integrations', platformIntegrationsRouter);
  const request = (method: string, url: string, body?: unknown, tenant = 'a', role: 'admin' | 'customer_service' = 'admin', secret?: string) =>
    new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = new IncomingMessage(new Socket()); req.method = method; req.url = url;
      const payload = body === undefined ? '' : JSON.stringify(body);
      req.headers = { authorization: `Bearer ${issueLocalIdentityTokenForTest({ tenantId: tenant, userId: `owner-${tenant}`, role })}`,
        'content-type': 'application/json', ...(payload ? { 'content-length': String(Buffer.byteLength(payload)) } : {}),
        ...(secret ? { 'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}` } : {}) };
      const res = new ServerResponse(req), chunks: string[] = [];
      res.write = ((chunk: unknown) => { chunks.push(String(chunk)); return true; }) as typeof res.write;
      res.end = ((chunk?: unknown) => { if (chunk) chunks.push(String(chunk)); const raw = chunks.join('');
        let body: unknown; try { body = JSON.parse(raw); } catch { body = raw; }
        resolve({ status: res.statusCode, body }); return res; }) as typeof res.end;
      req.on('error', reject); app(req, res); req.push(payload || null); if (payload) req.push(null);
    });
  const session = async (tenant = 'a') => {
    const result = await request('POST', '/api/oauth/whatsapp/session', {}, tenant); assert.equal(result.status, 200); return result.body.state;
  };
  const connect = (state: string, tenant = 'a', waba = '100', phone = '101') => request('POST', '/api/oauth/whatsapp/exchange', {
    state, code: `code-${tenant}`, sessionInfo: { waba_id: waba, phone_number_id: phone },
  }, tenant);
  const payload = { object: 'whatsapp_business_account', entry: [['100', '101'], ['200', '201'], ['300', '301']].map(([waba, phone]) => ({
    id: waba, changes: [{ field: 'messages', value: { metadata: { phone_number_id: phone }, statuses: [{ id: `wamid.${phone}`, status: 'delivered' }] } }],
  })) };
  try {
    const status = await request('GET', '/api/oauth/whatsapp/config');
    assert.equal(status.body.configured, true); assert.equal(status.body.connected, false);
    assert.ok(!JSON.stringify(status.body).includes('shared-secret'));
    assert.equal((await request('GET', '/api/oauth/whatsapp/config?tenantId=b')).status, 403);
    assert.equal((await request('POST', '/api/oauth/whatsapp/session', { tenantId: 'b' })).status, 403);
    assert.equal(providerCalls.length, 0, 'foreign caller-selected tenants must be rejected before any provider request');
    assert.equal((await request('POST', '/api/oauth/whatsapp/session', {}, 'a', 'customer_service')).status, 403);
    const stateA = await session();
    assert.equal((await connect(stateA, 'b')).status, 403); assert.equal(providerCalls.length, 0);
    assert.equal((await connect(stateA)).status, 200);
    const callsAfterA = providerCalls.length;
    assert.equal((await connect(stateA)).status, 403); assert.equal(providerCalls.length, callsAfterA);
    const stateB = await session('b');
    assert.equal((await connect(stateB, 'b', '200', '201')).status, 200);
    const a = rows.tenant_platform_apps!.find(row => row.tenant_id === 'a') as unknown as TenantPlatformAppRecord;
    const b = rows.tenant_platform_apps!.find(row => row.tenant_id === 'b') as unknown as TenantPlatformAppRecord;
    assert.equal(a.app_id, b.app_id); assert.equal(a.app_secret, 'ref:whatsapp-platform-app-secret');
    assert.equal(decryptSecret(a.access_token), 'token-code-a'); assert.equal(decryptSecret(b.access_token), 'token-code-b');
    assert.equal((await request('PUT', '/integrations/oauth-config', { metaSocialAppSecret: 'tenant-secret-override' })).status, 409);
    assert.equal((await request('DELETE', '/integrations/oauth-config/meta')).status, 409);
    assert.equal(a.app_secret, 'ref:whatsapp-platform-app-secret');
    paginated = true;
    assert.equal((await connect(await session())).status, 200); paginated = false;
    assert.ok(providerCalls.every(url => url.startsWith('https://graph.facebook.com/')));
    revokeDuringSubscription = true;
    assert.equal((await connect(await session())).body.error, 'whatsapp_account_version_changed');
    assert.equal(a.status, 'pending', 'a concurrent stop cannot be overwritten by authorization completion');
    revokeDuringSubscription = false; a.status = 'active';
    assert.equal(a.token_type, 'business_integration'); assert.equal(a.token_expires_at, '');
    assert.equal((await connect(await session('c'), 'c')).body.error, 'whatsapp_asset_owned_by_foreign_tenant');
    codeExpires = true;
    assert.equal((await connect(await session('d'), 'd')).body.error, 'whatsapp_token_expired'); codeExpires = false;
    phoneConnected = false;
    assert.equal((await connect(await session('d'), 'd')).body.error, 'whatsapp_phone_registration_required'); phoneConnected = true;
    subscriptionSucceeds = false;
    assert.equal((await connect(await session('e'), 'e', '400', '401')).body.error, 'whatsapp_subscription_not_confirmed'); subscriptionSucceeds = true;
    assert.deepEqual((await resolveSharedWhatsAppBindings(payload)).map(row => row.tenant_id), ['a', 'b']);
    assert.equal((await request('POST', '/api/webhooks/whatsapp', payload, 'a', 'admin', 'wrong')).status, 403);
    assert.deepEqual(readTenants, []);
    assert.equal((await request('POST', '/api/webhooks/whatsapp', payload, 'a', 'admin', 'shared-secret')).status, 200);
    assert.deepEqual(readTenants, ['a', 'b']);
    rows.tenant_platform_apps!.push({ ...a, id: 'duplicate', tenant_id: 'foreign' } as unknown as Record_);
    const reads = readTenants.length;
    assert.equal((await request('POST', '/api/webhooks/whatsapp', payload, 'a', 'admin', 'shared-secret')).status, 503);
    assert.equal(readTenants.length, reads); rows.tenant_platform_apps!.pop();
    assert.equal((await request('GET', '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=shared-verify&hub.challenge=hello')).body, 'hello');
    assert.equal((await request('GET', '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong')).status, 403);
    assert.equal((await request('POST', '/api/oauth/whatsapp/disconnect', {})).status, 200);
    assert.equal((await request('GET', '/api/oauth/whatsapp/config')).body.connected, false);
    assert.throws(() => resolveTenantWhatsAppConfig('a', a), /not_configured/);
    assert.deepEqual((await resolveSharedWhatsAppBindings(payload)).map(row => row.tenant_id), ['b']);
    tokenValid = false;
    const revoked = await request('POST', '/api/oauth/whatsapp/verify', {}, 'b');
    assert.equal(revoked.body.status, 'token_expired');
    assert.equal((await request('GET', '/api/oauth/whatsapp/config', undefined, 'b')).body.connected, false);
    assert.throws(() => resolveTenantWhatsAppConfig('b', b), /not_configured/);
    tokenValid = true;
    assert.equal((await connect(await session('b'), 'b', '200', '201')).status, 200);
    assert.equal((await request('POST', '/api/oauth/whatsapp/verify', {}, 'b')).body.connected, true);
    process.env.WHATSAPP_PLATFORM_APP_SECRET = 'rotated-secret';
    assert.throws(() => assertVerifiedWhatsAppAssets(b), /unverified/);
    assert.equal((await request('GET', '/api/oauth/whatsapp/config', undefined, 'b')).body.connected, false);
    store.supportsAtomicOperationLease = () => false;
    assert.equal((await request('POST', '/api/oauth/whatsapp/session', {})).status, 503);
    assert.equal(rows.tenant_platform_apps!.length, 2);
  } finally {
    Object.assign(store, original); axios.get = oldGet; axios.post = oldPost; Socket.prototype.connect = oldConnect;
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env);
  }
});
