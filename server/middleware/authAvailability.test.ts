import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { auth } from '../storage/index.js';
import { invalidatePbAdminToken } from '../storage/pb.js';
import { requireScopedAsset } from '../lib/assetAccess.js';
import { requireAuth } from './auth.js';
import { entitlementGate } from './subscription.js';
import { cloudMaterialMediaRouter } from '../routes/cloudMaterialMedia.js';

const originalVerifyToken = auth.verifyToken;
let status = 0;
let payload: Record<string, unknown> | null = null;
let nextCalled = false;

auth.verifyToken = async () => { throw new Error('provider offline'); };
try {
  await requireAuth(
    {
      method: 'GET',
      headers: { authorization: 'Bearer still-valid-token' },
      query: {},
      originalUrl: '/api/overseas/auth/me',
      url: '/api/overseas/auth/me',
    } as never,
    {
      locals: {},
      setHeader: () => undefined,
      status(code: number) { status = code; return this; },
      json(body: Record<string, unknown>) { payload = body; return this; },
    } as never,
    (() => { nextCalled = true; }) as never,
  );
  assert.equal(status, 503);
  assert.equal((payload as { error?: unknown } | null)?.error, 'auth_provider_unavailable');
  assert.equal(nextCalled, false);
  console.log('authentication provider outage semantics passed');
} finally {
  auth.verifyToken = originalVerifyToken;
}

status = 0;
nextCalled = false;
auth.verifyToken = async () => { throw new Error('provider offline'); };
try {
  await requireScopedAsset(
    {
      headers: { authorization: 'Bearer still-valid-token' },
      query: {},
      baseUrl: '/media',
      path: '/tenants/tenant-1/private.mp4',
    } as never,
    {
      setHeader: () => undefined,
      status(code: number) { status = code; return this; },
      end() { return this; },
    } as never,
    (() => { nextCalled = true; }) as never,
  );
  assert.equal(status, 503);
  assert.equal(nextCalled, false);
  console.log('scoped asset authentication outage semantics passed');
} finally {
  auth.verifyToken = originalVerifyToken;
}

auth.verifyToken = async () => { throw new Error('provider offline'); };
const cloudMediaApp = express();
cloudMediaApp.use('/cloud-files', cloudMaterialMediaRouter);
const cloudMediaServer = http.createServer(cloudMediaApp);
try {
  await new Promise<void>(resolve => cloudMediaServer.listen(0, '127.0.0.1', resolve));
  const address = cloudMediaServer.address();
  if (!address || typeof address === 'string') throw new Error('cloud media test server did not bind');
  const response = await fetch(`http://127.0.0.1:${address.port}/cloud-files/material-1/signed/invalid/media.mp4`);
  assert.equal(response.status, 503);
  assert.equal((await response.json() as { error?: unknown }).error, 'auth_provider_unavailable');
  console.log('cloud material authentication outage semantics passed');
} finally {
  auth.verifyToken = originalVerifyToken;
  cloudMediaServer.closeAllConnections();
  await new Promise<void>(resolve => cloudMediaServer.close(() => resolve()));
}

const originalFetch = globalThis.fetch;
const previousEnvironment = {
  SUBSCRIPTION_ENFORCED: process.env.SUBSCRIPTION_ENFORCED,
  PB_ADMIN_EMAIL: process.env.PB_ADMIN_EMAIL,
  PB_ADMIN_PASSWORD: process.env.PB_ADMIN_PASSWORD,
  PB_URL: process.env.PB_URL,
};
status = 0;
payload = null;
nextCalled = false;
process.env.SUBSCRIPTION_ENFORCED = 'true';
process.env.PB_ADMIN_EMAIL = 'admin@example.test';
process.env.PB_ADMIN_PASSWORD = 'contract-password';
process.env.PB_URL = 'http://pocketbase.test';
invalidatePbAdminToken();
auth.verifyToken = async () => ({ userId: 'user-1', tenantId: 'tenant-1' });
globalThis.fetch = async input => String(input).endsWith('/auth-with-password')
  ? Response.json({ token: 'admin-token' })
  : Response.json({ message: 'temporarily unavailable' }, { status: 503 });
try {
  await entitlementGate()(
    { headers: { authorization: 'Bearer still-valid-token' } } as never,
    {
      locals: {},
      setHeader: () => undefined,
      status(code: number) { status = code; return this; },
      json(body: Record<string, unknown>) { payload = body; return this; },
    } as never,
    (() => { nextCalled = true; }) as never,
  );
  assert.equal(status, 503);
  assert.equal((payload as { error?: unknown } | null)?.error, 'subscription_authority_unavailable');
  assert.equal(nextCalled, false);
  console.log('subscription authority outage semantics passed');
} finally {
  auth.verifyToken = originalVerifyToken;
  globalThis.fetch = originalFetch;
  invalidatePbAdminToken();
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
