import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  PB_URL: process.env.PB_URL,
  PB_ADMIN_EMAIL: process.env.PB_ADMIN_EMAIL,
  PB_ADMIN_PASSWORD: process.env.PB_ADMIN_PASSWORD,
  DEMO_ACCOUNT_REGISTRY_FILE: process.env.DEMO_ACCOUNT_REGISTRY_FILE,
  DEMO_ACCOUNT_REGISTRY_BACKUP_FILE: process.env.DEMO_ACCOUNT_REGISTRY_BACKUP_FILE,
};
const originalFetch = globalThis.fetch;
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-login-registry-'));
const primaryFile = path.join(temporaryDirectory, 'demo-account-registry.json');
const backupFile = path.join(temporaryDirectory, 'demo-account-registry.backup.json');
const email = 'customer@example.test';
const tenantId = 'tenant-login-read-only';
const registry = {
  [email]: {
    email,
    userId: 'user-login-read-only',
    tenantId,
    status: 'customer',
    credentialState: 'password_reset_required',
    guidePending: false,
  },
};
const contents = JSON.stringify(registry, null, 2);
fs.writeFileSync(primaryFile, contents, { mode: 0o600 });
fs.writeFileSync(backupFile, contents, { mode: 0o600 });

process.env.NODE_ENV = 'test';
process.env.PB_URL = 'http://pocketbase.example.test';
delete process.env.PB_ADMIN_EMAIL;
delete process.env.PB_ADMIN_PASSWORD;
process.env.DEMO_ACCOUNT_REGISTRY_FILE = primaryFile;
process.env.DEMO_ACCOUNT_REGISTRY_BACKUP_FILE = backupFile;

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith('/api/collections/users/auth-with-password') && init?.method === 'POST') {
    return Response.json({
      token: 'provider-login-token',
      record: { id: 'user-login-read-only', email, name: 'Customer', tenantId, role: 'super_admin' },
    });
  }
  if (url.includes(`/api/collections/tenants/records/${tenantId}`)) {
    return Response.json({
      id: tenantId,
      name: 'Customer Tenant',
      registeredEmail: email,
      subscriptionStatus: 'active',
      subscriptionPlan: 'customer',
      subscriptionExpiresAt: null,
    });
  }
  return new Response('not found', { status: 404 });
};

const { authRouter } = await import('../routes/auth.js');
const app = express();
app.use(express.json());
app.use('/auth', authRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('test server did not bind a TCP port');
const origin = `http://127.0.0.1:${address.port}`;
const primaryBefore = fs.readFileSync(primaryFile);
const backupBefore = fs.readFileSync(backupFile);
const primaryMtime = fs.statSync(primaryFile).mtimeMs;
const backupMtime = fs.statSync(backupFile).mtimeMs;

try {
  const responses = await Promise.all(Array.from({ length: 12 }, () => originalFetch(`${origin}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'provider-owned-password' }),
  })));
  assert.ok(responses.every(response => response.status === 200), 'concurrent provider logins must remain successful');
  assert.deepEqual(fs.readFileSync(primaryFile), primaryBefore, 'successful login must not rewrite the primary demo registry');
  assert.deepEqual(fs.readFileSync(backupFile), backupBefore, 'successful login must not rewrite the backup demo registry');
  assert.equal(fs.statSync(primaryFile).mtimeMs, primaryMtime);
  assert.equal(fs.statSync(backupFile).mtimeMs, backupMtime);
  const stored = JSON.parse(fs.readFileSync(primaryFile, 'utf8')) as typeof registry;
  assert.equal(stored[email].credentialState, 'password_reset_required', 'login must not smuggle a registry state transition');
  console.log('provider login registry read-only tests passed');
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  globalThis.fetch = originalFetch;
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
