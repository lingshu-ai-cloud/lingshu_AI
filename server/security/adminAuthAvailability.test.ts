import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  ENABLE_LOCAL_DEV_FALLBACK: process.env.ENABLE_LOCAL_DEV_FALLBACK,
  LOCAL_STORE_DIR: process.env.LOCAL_STORE_DIR,
  LOCAL_ADMIN_EMAIL: process.env.LOCAL_ADMIN_EMAIL,
  WORKBENCH_ADMIN_EMAIL: process.env.WORKBENCH_ADMIN_EMAIL,
  ADMIN_DASHBOARD_EMAILS: process.env.ADMIN_DASHBOARD_EMAILS,
  CHANNELS_DATA_FILE: process.env.CHANNELS_DATA_FILE,
  PLUGINS_DATA_FILE: process.env.PLUGINS_DATA_FILE,
};
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-admin-auth-availability-'));
process.env.NODE_ENV = 'test';
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
process.env.LOCAL_STORE_DIR = path.join(temporaryDirectory, 'local-store');
process.env.LOCAL_ADMIN_EMAIL = 'availability-admin@example.test';
process.env.WORKBENCH_ADMIN_EMAIL = '';
process.env.ADMIN_DASHBOARD_EMAILS = '';
process.env.CHANNELS_DATA_FILE = path.join(temporaryDirectory, 'channels.json');
process.env.PLUGINS_DATA_FILE = path.join(temporaryDirectory, 'plugins.json');
fs.writeFileSync(process.env.CHANNELS_DATA_FILE, '[]', { mode: 0o600 });
fs.writeFileSync(process.env.PLUGINS_DATA_FILE, '[]', { mode: 0o600 });

const [
  { auth },
  { issueLocalIdentityTokenForTest },
  { adminRouter },
  { pluginsRouter },
  { channelsRouter },
] = await Promise.all([
  import('../storage/index.js'),
  import('../auth/localIdentity.js'),
  import('../routes/admin.js'),
  import('../routes/plugins.js'),
  import('../routes/channels.js'),
]);

const originalVerifyToken = auth.verifyToken;
const adminToken = issueLocalIdentityTokenForTest({
  userId: 'local_user_admin_availability_admin_example_test',
  tenantId: 'local_tenant_admin_availability_admin_example_test',
  email: 'availability-admin@example.test',
  accountType: 'admin',
});
let verificationCalls = 0;
let failOnCall = Number.POSITIVE_INFINITY;
auth.verifyToken = async authorization => {
  verificationCalls += 1;
  if (verificationCalls === failOnCall) throw new Error('simulated identity provider outage');
  return originalVerifyToken(authorization);
};

const app = express();
app.use(express.json());
app.use('/admin', adminRouter);
app.use('/plugins', pluginsRouter);
app.use('/channels', channelsRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('test server did not bind a TCP port');
const origin = `http://127.0.0.1:${address.port}`;

async function expectProviderOutage(
  pathname: string,
  providerCall: number,
  init: RequestInit = {},
): Promise<void> {
  verificationCalls = 0;
  failOnCall = providerCall;
  const response = await fetch(`${origin}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${adminToken}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const body = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 503, `${pathname} must map identity authority loss to 503`);
  assert.equal(body.error, 'auth_provider_unavailable');
  assert.match(response.headers.get('cache-control') || '', /no-store/);
}

try {
  // Admin routes authenticate directly through the shared guard.
  await expectProviderOutage('/admin/demo-accounts', 1);
  // Plugins/channels share requireAuth's verified identity with the admin
  // helper, so provider loss is handled once and never retried mid-request.
  await expectProviderOutage('/plugins', 1);
  await expectProviderOutage('/plugins/shopify/config', 1, {
    method: 'PUT',
    body: JSON.stringify({ accessToken: 'must-not-be-persisted' }),
  });
  await expectProviderOutage('/channels/status', 1);
  await expectProviderOutage('/channels', 1, {
    method: 'POST',
    body: JSON.stringify({ type: 'telegram', label: 'must-not-be-created' }),
  });
  assert.equal(fs.readFileSync(process.env.CHANNELS_DATA_FILE, 'utf8'), '[]');
  assert.equal(fs.readFileSync(process.env.PLUGINS_DATA_FILE, 'utf8'), '[]');

  console.log('admin, plugin and channel auth availability contracts passed');
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  auth.verifyToken = originalVerifyToken;
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
