import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  PB_URL: process.env.PB_URL,
  DISABLE_LOCAL_AUTH_FALLBACK: process.env.DISABLE_LOCAL_AUTH_FALLBACK,
  LOCAL_STORE_DIR: process.env.LOCAL_STORE_DIR,
};
const originalCwd = process.cwd();
const temporaryCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-support-access-authorization-'));

process.chdir(temporaryCwd);
process.env.NODE_ENV = 'test';
process.env.PB_URL = 'http://127.0.0.1:1';
process.env.DISABLE_LOCAL_AUTH_FALLBACK = 'false';
process.env.LOCAL_STORE_DIR = path.join(temporaryCwd, 'local-store');

const { supportAccessRouter } = await import(`./supportAccess.js?authorization-test=${Date.now()}`);

const app = express();
app.use(express.json());
app.use('/support-access', supportAccessRouter);

const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('test server did not bind a TCP port');
const origin = `http://127.0.0.1:${address.port}`;

function localToken(role: 'super_admin' | 'admin' | 'social_operator' | 'customer_service'): string {
  return `local-demo.${Buffer.from(JSON.stringify({
    userId: `support-access-${role}`,
    tenantId: 'support-access-tenant',
    email: `${role}@example.test`,
    role,
  }), 'utf8').toString('base64url')}`;
}

async function request(
  pathname: string,
  role: 'super_admin' | 'admin' | 'social_operator' | 'customer_service',
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${origin}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${localToken(role)}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

try {
  for (const role of ['admin', 'social_operator', 'customer_service'] as const) {
    const denied = await request('/support-access/settings', role, {
      method: 'PUT',
      body: JSON.stringify({ mode: 'default' }),
    });
    assert.equal(denied.status, 403, `${role} must not change support access authorization`);
    assert.equal(denied.body.error, 'tenant_owner_required');
  }

  const enabled = await request('/support-access/settings', 'super_admin', {
    method: 'PUT',
    body: JSON.stringify({ mode: 'default' }),
  });
  assert.equal(enabled.status, 200, 'tenant owner must be able to change support access authorization');
  assert.equal(enabled.body.defaultAuthorized, true);

  const visibleToOwner = await request('/support-access/settings', 'super_admin');
  assert.equal(visibleToOwner.status, 200);
  assert.equal(visibleToOwner.body.defaultAuthorized, true);

  const hiddenFromMember = await request('/support-access/settings', 'social_operator');
  assert.equal(hiddenFromMember.status, 403, 'support authorization settings must be owner-only');

  console.log('support access owner authorization tests passed');
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  process.chdir(originalCwd);
  fs.rmSync(temporaryCwd, { recursive: true, force: true });
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
