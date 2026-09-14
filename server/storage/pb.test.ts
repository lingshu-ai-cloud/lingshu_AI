import assert from 'node:assert/strict';
import {
  adminFetch,
  getPbAdminToken,
  getTenantIdFromToken,
  invalidatePbAdminToken,
  invalidatePbIdentityCache,
  PbAuthUnavailableError,
  pbRequestTimeoutMs,
} from './pb.js';

const originalFetch = globalThis.fetch;
const originalEmail = process.env.PB_ADMIN_EMAIL;
const originalPassword = process.env.PB_ADMIN_PASSWORD;
const originalUrl = process.env.PB_URL;
const originalAuthCacheTtl = process.env.PB_AUTH_CACHE_TTL_MS;
const originalRequestTimeout = process.env.PB_REQUEST_TIMEOUT_MS;

process.env.PB_ADMIN_EMAIL = 'admin@example.test';
process.env.PB_ADMIN_PASSWORD = 'test-password';
process.env.PB_URL = 'http://pocketbase.test';
invalidatePbAdminToken();

const calls: Array<{ url: string; authorization: string }> = [];
let authCount = 0;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  const headers = init?.headers as Record<string, string> | undefined;
  calls.push({ url, authorization: headers?.Authorization ?? '' });
  if (url.endsWith('/api/collections/_superusers/auth-with-password')) {
    authCount += 1;
    return Response.json({ token: `admin-token-${authCount}` });
  }
  if (url.endsWith('/api/collections/tenant_profiles/records')) {
    if (headers?.Authorization === 'admin-token-1') {
      return Response.json({ message: 'Only superusers can perform this action.' }, { status: 403 });
    }
    return Response.json({ id: 'profile-1' });
  }
  return new Response(null, { status: 404 });
};

try {
  const response = await adminFetch('/api/collections/tenant_profiles/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 200);
  assert.equal(authCount, 2, 'a stale PocketBase admin token should trigger one re-authentication');
  const writes = calls.filter(call => call.url.endsWith('/api/collections/tenant_profiles/records'));
  assert.deepEqual(writes.map(call => call.authorization), ['admin-token-1', 'admin-token-2']);

  invalidatePbAdminToken();
  authCount = 0;
  globalThis.fetch = async input => {
    if (String(input).endsWith('/api/collections/_superusers/auth-with-password')) {
      authCount += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return Response.json({ token: 'singleflight-admin-token' });
    }
    return new Response(null, { status: 404 });
  };
  const tokens = await Promise.all(Array.from({ length: 25 }, () => getPbAdminToken()));
  assert.equal(authCount, 1, 'concurrent admin requests must share one authentication call');
  assert.ok(tokens.every(token => token === 'singleflight-admin-token'));

  invalidatePbIdentityCache();
  process.env.PB_AUTH_CACHE_TTL_MS = '5000';
  let refreshCount = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith('/api/collections/users/auth-refresh')) {
      refreshCount += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      const authorization = String((init?.headers as Record<string, string> | undefined)?.Authorization || '');
      return Response.json({ record: { id: `user-${authorization}`, tenantId: `tenant-${authorization}` } });
    }
    return new Response(null, { status: 404 });
  };
  const identities = await Promise.all(Array.from({ length: 50 }, () => getTenantIdFromToken('Bearer user-token-a')));
  assert.equal(refreshCount, 1, 'concurrent bearer checks must share one auth-refresh call');
  assert.ok(identities.every(identity => identity?.tenantId === 'tenant-user-token-a'));
  await getTenantIdFromToken('Bearer user-token-a');
  assert.equal(refreshCount, 1, 'a recently verified identity should be served from the bounded short cache');
  await getTenantIdFromToken('Bearer user-token-b');
  assert.equal(refreshCount, 2, 'cache entries must remain isolated per bearer token');

  invalidatePbIdentityCache();
  let unavailableRefreshCount = 0;
  globalThis.fetch = async () => {
    unavailableRefreshCount += 1;
    return Response.json({ message: 'temporarily unavailable' }, { status: 503 });
  };
  await assert.rejects(
    getTenantIdFromToken('Bearer still-valid-token'),
    PbAuthUnavailableError,
    'a provider outage must not be reported as an invalid bearer token',
  );
  await assert.rejects(getTenantIdFromToken('Bearer still-valid-token'), PbAuthUnavailableError);
  assert.equal(unavailableRefreshCount, 2, 'provider outages must not be negative-cached as invalid identities');
  globalThis.fetch = async () => Response.json({ message: 'invalid token' }, { status: 401 });
  assert.equal(await getTenantIdFromToken('Bearer invalid-token'), null, 'a terminal token rejection remains unauthenticated');

  process.env.PB_REQUEST_TIMEOUT_MS = '25';
  assert.equal(pbRequestTimeoutMs(), 500, 'PocketBase deadlines must keep a safe lower bound');
  process.env.PB_REQUEST_TIMEOUT_MS = '500';
  invalidatePbAdminToken();
  globalThis.fetch = async (_input, init) => await new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    const rejectAbort = () => reject(signal?.reason ?? new DOMException('aborted', 'AbortError'));
    if (signal?.aborted) rejectAbort();
    else signal?.addEventListener('abort', rejectAbort, { once: true });
  });
  const startedAt = Date.now();
  const keepEventLoopAlive = setTimeout(() => {}, 1_000);
  assert.equal(await getPbAdminToken(), null, 'an unresponsive PocketBase auth request must fail within its deadline');
  clearTimeout(keepEventLoopAlive);
  assert.ok(Date.now() - startedAt < 1_500, 'PocketBase timeout must remain bounded');
  console.log('PocketBase admin retry passed');
} finally {
  globalThis.fetch = originalFetch;
  invalidatePbAdminToken();
  invalidatePbIdentityCache();
  if (originalEmail === undefined) delete process.env.PB_ADMIN_EMAIL; else process.env.PB_ADMIN_EMAIL = originalEmail;
  if (originalPassword === undefined) delete process.env.PB_ADMIN_PASSWORD; else process.env.PB_ADMIN_PASSWORD = originalPassword;
  if (originalUrl === undefined) delete process.env.PB_URL; else process.env.PB_URL = originalUrl;
  if (originalAuthCacheTtl === undefined) delete process.env.PB_AUTH_CACHE_TTL_MS; else process.env.PB_AUTH_CACHE_TTL_MS = originalAuthCacheTtl;
  if (originalRequestTimeout === undefined) delete process.env.PB_REQUEST_TIMEOUT_MS; else process.env.PB_REQUEST_TIMEOUT_MS = originalRequestTimeout;
}
