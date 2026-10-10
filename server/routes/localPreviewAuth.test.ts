import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-local-preview-auth-'));
const accountsFile = path.join(temporaryDirectory, 'local-auth-accounts.json');
const tenantsFile = path.join(temporaryDirectory, 'local-auth-tenants.json');
const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  ENABLE_LOCAL_DEV_FALLBACK: process.env.ENABLE_LOCAL_DEV_FALLBACK,
  LINGSHU_LOCAL_PREVIEW: process.env.LINGSHU_LOCAL_PREVIEW,
  LINGSHU_PREVIEW_AUTH_EMAIL: process.env.LINGSHU_PREVIEW_AUTH_EMAIL,
  LOCAL_DEMO_TOKEN_SECRET: process.env.LOCAL_DEMO_TOKEN_SECRET,
  LOCAL_AUTH_ACCOUNTS_FILE: process.env.LOCAL_AUTH_ACCOUNTS_FILE,
  LOCAL_TENANTS_DATA_FILE: process.env.LOCAL_TENANTS_DATA_FILE,
};

process.env.NODE_ENV = 'test';
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
process.env.LINGSHU_LOCAL_PREVIEW = '1';
process.env.LINGSHU_PREVIEW_AUTH_EMAIL = 'beauty-showcase@local.test';
process.env.LOCAL_DEMO_TOKEN_SECRET = 'local-preview-test-secret-with-at-least-thirty-two-bytes';
process.env.LOCAL_AUTH_ACCOUNTS_FILE = accountsFile;
process.env.LOCAL_TENANTS_DATA_FILE = tenantsFile;

const tenant = {
  id: 'local_tenant_customer_beauty',
  name: 'Beauty Showcase',
  companyName: 'Beauty Showcase',
  contactName: '',
  contact: '',
  industry: '',
  notes: '',
  inviteCode: '',
  subscriptionStatus: 'active',
  subscriptionPlan: 'customer',
  subscriptionExpiresAt: null,
  createdAt: '2026-10-10T00:00:00.000Z',
};
const account = {
  userId: 'local_user_beauty',
  tenantId: tenant.id,
  email: 'beauty-showcase@local.test',
  name: 'Beauty Showcase',
  accountType: 'customer',
  role: 'admin',
  salt: 'unavailable-password-salt',
  passwordHash: 'a'.repeat(128),
  createdAt: '2026-10-10T00:00:00.000Z',
};
fs.writeFileSync(accountsFile, JSON.stringify([account], null, 2), { mode: 0o600 });
fs.writeFileSync(tenantsFile, JSON.stringify([tenant], null, 2), { mode: 0o600 });

const [{ authRouter, isLocalPreviewLoopbackAddress, localPreviewRequestRejection }, { pbAuth }] = await Promise.all([
  import('./auth.js'),
  import('../storage/pbStore.js'),
]);
assert.equal(isLocalPreviewLoopbackAddress('127.0.0.1'), true);
assert.equal(isLocalPreviewLoopbackAddress('::1'), true);
assert.equal(isLocalPreviewLoopbackAddress('::ffff:127.0.0.1'), true);
assert.equal(isLocalPreviewLoopbackAddress('192.168.1.20'), false);
assert.equal(isLocalPreviewLoopbackAddress('::ffff:192.168.1.20'), false);
assert.equal(isLocalPreviewLoopbackAddress(undefined), false);
assert.equal(localPreviewRequestRejection('http://127.0.0.1:5177', '127.0.0.1'), null);
assert.equal(
  localPreviewRequestRejection('http://127.0.0.1:5177', '192.168.1.20'),
  'local_preview_loopback_required',
  'a spoofed allowed Origin from a LAN peer must still be rejected by the route guard',
);
assert.equal(
  localPreviewRequestRejection('http://malicious.local', '127.0.0.1'),
  'local_preview_origin_required',
);
const app = express();
app.use(express.json());
app.use('/auth', authRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('test server did not bind');
const baseUrl = `http://127.0.0.1:${address.port}/auth/local-preview-session`;

try {
  const rejected = await fetch(baseUrl, { method: 'POST' });
  assert.equal(rejected.status, 403, 'a non-browser or non-loopback origin must not receive a token');

  const accountsBefore = fs.readFileSync(accountsFile);
  const issued = await fetch(baseUrl, {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:5177' },
  });
  assert.equal(issued.status, 200);
  assert.equal(issued.headers.get('cache-control'), 'no-store');
  const body = await issued.json() as { token?: string };
  assert.match(String(body.token), /^local-demo\.v1\./);
  assert.deepEqual(await pbAuth.verifyToken(`Bearer ${body.token}`), {
    userId: account.userId,
    tenantId: account.tenantId,
    dataAuthority: 'local',
  });
  assert.deepEqual(
    fs.readFileSync(accountsFile),
    accountsBefore,
    'selecting an existing local preview identity must not reset or reveal its unavailable password',
  );

  process.env.LINGSHU_PREVIEW_AUTH_EMAIL = 'fresh-preview@local.test';
  const provisioned = await fetch(baseUrl, {
    method: 'POST',
    headers: { Origin: 'http://localhost:5177' },
  });
  assert.equal(provisioned.status, 200);
  const createdAccounts = JSON.parse(fs.readFileSync(accountsFile, 'utf8')) as Array<typeof account>;
  const created = createdAccounts.find(item => item.email === 'fresh-preview@local.test');
  assert.equal(created?.role, 'admin');
  assert.equal(created?.accountType, 'customer');
  assert.equal(createdAccounts.length, 2);
  const createdTenants = JSON.parse(fs.readFileSync(tenantsFile, 'utf8')) as Array<typeof tenant>;
  const createdTenant = createdTenants.find(item => item.id === created?.tenantId);
  assert.equal(createdTenant?.subscriptionPlan, 'customer');
  assert.equal(createdTenant?.subscriptionStatus, 'active');

  process.env.LINGSHU_LOCAL_PREVIEW = '0';
  const disabled = await fetch(baseUrl, {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:5177' },
  });
  assert.equal(disabled.status, 404, 'ordinary development servers must not expose the preview token issuer');

  process.env.LINGSHU_LOCAL_PREVIEW = '1';
  process.env.NODE_ENV = 'production';
  const production = await fetch(baseUrl, {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:5177' },
  });
  assert.equal(production.status, 404, 'production must never expose the preview token issuer');

  console.log('local preview auth bootstrap tests passed');
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
