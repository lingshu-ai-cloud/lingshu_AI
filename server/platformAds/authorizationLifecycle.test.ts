import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertAuthorizationUsable, authorizationAt, inspectMetaAuthorization, META_REQUIRED_AD_SCOPES, publicAuthorization } from './authorizationLifecycle.js';

const now = Date.parse('2026-10-24T00:00:00Z');
process.env.META_ADS_APP_ID = '123';
process.env.META_ADS_APP_SECRET = 'private-app-secret';
process.env.META_ADS_API_VERSION = 'v26.0';
const valid = { app_id: '123', user_id: '456', is_valid: true, scopes: [...META_REQUIRED_AD_SCOPES], expires_at: now / 1000 + 60 * 86400, data_access_expires_at: now / 1000 + 90 * 86400 };
const inspect = (data: unknown) => inspectMetaAuthorization('private-user-token', { now, transport: (async (input, init) => {
  const url = new URL(String(input));
  assert.equal(url.origin, 'https://graph.facebook.com');
  assert.equal(url.pathname, '/v26.0/debug_token');
  assert.equal(init?.method, 'GET', 'health inspection never writes provider resources');
  assert.equal(init?.body, undefined);
  assert.equal(url.searchParams.get('access_token'), null, 'app credential stays in authorization header');
  return Response.json({ data });
}) as typeof fetch });

const healthy = await inspect(valid);
assert.equal(healthy.status, 'healthy');
assert.equal(healthy.providerUserId, '456');
assert.equal(authorizationAt(healthy, now + 54 * 86400000).status, 'expiring');
assert.equal(authorizationAt(healthy, now + 60 * 86400000).status, 'expired');
assert.equal((await inspect({ ...valid, scopes: ['ads_read'] })).status, 'missing_permissions');
assert.equal((await inspect({ is_valid: false })).status, 'revoked');
await assert.rejects(inspect({ ...valid, app_id: '999' }), (error: any) => error.code === 'AUTH_APP_MISMATCH');
await assert.rejects(inspect({ ...valid, user_id: undefined }), (error: any) => error.code === 'INVALID_RESPONSE');
await assert.rejects(inspect({ ...valid, expires_at: 'broken' }), (error: any) => error.code === 'INVALID_RESPONSE');
assert.equal('providerUserId' in publicAuthorization(healthy), false);
assert.equal('appId' in publicAuthorization(healthy), false);
assert.equal(authorizationAt().status, 'unknown');
assert.doesNotThrow(() => assertAuthorizationUsable(), 'legacy connections without metadata retain compatibility');
assert.throws(() => assertAuthorizationUsable({ status: 'healthy', reasonCode: 'AUTH_VALID', expiresAt: 'invalid' }), (error: any) => error.code === 'AUTH_METADATA_INVALID', 'corrupt expiry metadata fails closed');
assert.equal((await inspect({ ...valid, expires_at: 0, data_access_expires_at: 0 })).expiresAt, undefined, 'provider zero expiry is not an invented permanent promise');
await assert.rejects(inspectMetaAuthorization('private-user-token', { transport: (async () => { throw new Error('private-app-secret'); }) as typeof fetch }), (error: any) => error.code === 'AUTH_CHECK_UNAVAILABLE' && !error.message.includes('private'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-auth-lifecycle-'));
process.env.LOCAL_STORE_DIR = dir;
process.env.PB_URL = 'http://127.0.0.1:1';
process.env.NODE_ENV = 'test';
process.env.DATA_BACKEND = 'pocketbase';
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
const { store } = await import('../storage/index.js');
const { encryptSecret } = await import('../lib/tenantPlatformApps.js');
const { getConnectionCredential, listConnections, checkConnectionAuthorization } = await import('./connections.js');
const originalFetch = globalThis.fetch;
try {
  const record = await store.create<any>('platform_ad_connections', { tenant_id: 'tenant', provider: 'meta', tokenCipher: encryptSecret('test-token'), authorization: { ...healthy, expiresAt: '2020-01-01T00:00:00Z' }, status: 'connected', accountId: '1' });
  await assert.rejects(getConnectionCredential('tenant', record.id), (error: any) => error.code === 'AUTH_EXPIRED');
  assert.equal((await listConnections('tenant'))[0].authorization.status, 'expired', 'expired connection remains visible with history');
  await assert.rejects(getConnectionCredential('other-tenant', record.id), (error: any) => error.code === 'NOT_FOUND');
  globalThis.fetch = (async (input, init) => {
    if (String(input).startsWith('https://graph.facebook.com/')) return Response.json({ data: { is_valid: false } });
    return originalFetch(input, init);
  }) as typeof fetch;
  const checked = await checkConnectionAuthorization('tenant', record.id);
  assert.equal(checked.authorization.status, 'revoked');
  await assert.rejects(getConnectionCredential('tenant', record.id), (error: any) => error.code === 'AUTH_REVOKED');
  assert.equal((await store.getById<any>('platform_ad_connections', record.id)).accountId, '1');
  globalThis.fetch = (async (input, init) => {
    if (!String(input).startsWith('https://graph.facebook.com/')) return originalFetch(input, init);
    await store.update('platform_ad_connections', record.id, { tokenCipher: encryptSecret('replacement-grant'), authorization: { status: 'unknown', reasonCode: 'NEW_GRANT' } });
    return Response.json({ data: valid });
  }) as typeof fetch;
  await assert.rejects(checkConnectionAuthorization('tenant', record.id), (error: any) => error.code === 'AUTH_CHECK_STALE');
  assert.equal((await store.getById<any>('platform_ad_connections', record.id)).authorization.reasonCode, 'NEW_GRANT', 'late health response cannot overwrite a replacement authorization');
  console.log('Meta authorization lifecycle expiry, permission, app isolation, redaction and credential gates passed');
} finally { globalThis.fetch = originalFetch; fs.rmSync(dir, { recursive: true, force: true }); }
