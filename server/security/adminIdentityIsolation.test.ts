import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { Identity } from '../storage/datastore.js';

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  LOCAL_ADMIN_EMAIL: process.env.LOCAL_ADMIN_EMAIL,
  WORKBENCH_ADMIN_EMAIL: process.env.WORKBENCH_ADMIN_EMAIL,
  ADMIN_DASHBOARD_EMAILS: process.env.ADMIN_DASHBOARD_EMAILS,
  CHANNELS_DATA_FILE: process.env.CHANNELS_DATA_FILE,
  ENABLE_LOCAL_DEV_FALLBACK: process.env.ENABLE_LOCAL_DEV_FALLBACK,
  LOCAL_STORE_DIR: process.env.LOCAL_STORE_DIR,
};
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-admin-identity-'));
const channelsDataFile = path.join(temporaryDirectory, 'channels.json');
fs.writeFileSync(channelsDataFile, '[]', { mode: 0o600 });

process.env.NODE_ENV = 'test';
process.env.LOCAL_ADMIN_EMAIL = 'local-admin@example.test';
process.env.WORKBENCH_ADMIN_EMAIL = '';
process.env.ADMIN_DASHBOARD_EMAILS = 'configured-admin@example.test';
process.env.CHANNELS_DATA_FILE = channelsDataFile;
// This isolated route test has no PocketBase fixture. Explicitly opt into the
// local test adapter and point it at the test directory; production remains
// fail-closed and never inherits this behavior from NODE_ENV alone.
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
process.env.LOCAL_STORE_DIR = path.join(temporaryDirectory, 'local-store');

const [
  { auth },
  { channelsRouter },
  { setAdminIdentityDependenciesForTests },
  { issueLocalIdentityTokenForTest },
] = await Promise.all([
  import('../storage/index.js'),
  import('../routes/channels.js'),
  import('../lib/demoAccounts.js'),
  import('../auth/localIdentity.js'),
]);

const originalVerifyToken = auth.verifyToken;
const sharedAdminTenant = 'internal-admin-tenant';
const identities = new Map<string, Identity>([
  ['same-tenant-peer', { userId: 'same-tenant-peer-user', tenantId: sharedAdminTenant }],
  ['ordinary-peer', { userId: 'ordinary-peer-user', tenantId: sharedAdminTenant }],
  ['registry-admin', { userId: 'registry-admin-user', tenantId: sharedAdminTenant }],
  ['wrong-tenant-admin', { userId: 'wrong-tenant-admin-user', tenantId: 'other-tenant' }],
  ['mismatched-admin', { userId: 'mismatched-admin-user', tenantId: sharedAdminTenant }],
  ['configured-admin', { userId: 'configured-admin-user', tenantId: sharedAdminTenant }],
  ['configured-admin-missing', { userId: 'configured-admin-missing-user', tenantId: sharedAdminTenant }],
  ['configured-admin-incomplete', { userId: 'configured-admin-incomplete-user', tenantId: sharedAdminTenant }],
  ['platform-admin', { userId: 'platform-admin-user', tenantId: 'platform-admin-tenant' }],
  ['tenant-owner', { userId: 'tenant-owner-user', tenantId: sharedAdminTenant }],
  ['missing-user-id', { userId: '', tenantId: sharedAdminTenant }],
  ['missing-tenant-id', { userId: 'configured-admin-user', tenantId: '' }],
]);
const users = new Map<string, Record<string, unknown>>([
  ['ordinary-peer-user', {
    id: 'ordinary-peer-user', tenantId: sharedAdminTenant, email: 'ordinary-peer@example.test', role: 'member',
  }],
  ['registry-admin-user', {
    id: 'registry-admin-user', tenantId: sharedAdminTenant, email: 'registry-admin@example.test', role: 'member',
  }],
  ['wrong-tenant-admin-user', {
    id: 'wrong-tenant-admin-user', tenantId: 'other-tenant', email: 'wrong-tenant-admin@example.test', role: 'member',
  }],
  ['mismatched-admin-user', {
    id: 'mismatched-admin-user', tenantId: sharedAdminTenant, email: 'different-email@example.test', role: 'member',
  }],
  ['configured-admin-user', {
    id: 'configured-admin-user', tenantId: sharedAdminTenant, email: 'configured-admin@example.test', role: 'member',
  }],
  ['configured-admin-incomplete-user', {
    id: 'configured-admin-incomplete-user', email: 'configured-admin@example.test', role: 'member',
  }],
  ['platform-admin-user', {
    id: 'platform-admin-user', tenantId: 'platform-admin-tenant', email: 'platform-admin@example.test', platformRole: 'admin',
  }],
  ['tenant-owner-user', {
    id: 'tenant-owner-user', tenantId: sharedAdminTenant, email: 'tenant-owner@example.test', role: 'super_admin',
  }],
]);
const registry = {
  'registry-admin@example.test': {
    email: 'registry-admin@example.test', userId: 'registry-admin-user', tenantId: sharedAdminTenant, status: 'admin' as const,
  },
  'wrong-tenant-admin@example.test': {
    email: 'wrong-tenant-admin@example.test', userId: 'wrong-tenant-admin-user', tenantId: sharedAdminTenant, status: 'admin' as const,
  },
  'mismatched-admin@example.test': {
    email: 'mismatched-admin@example.test', userId: 'mismatched-admin-user', tenantId: sharedAdminTenant, status: 'admin' as const,
  },
};

function localToken(payload: Record<string, string>): string {
  return issueLocalIdentityTokenForTest({
    userId: payload.userId,
    tenantId: payload.tenantId,
    email: payload.email,
    accountType: payload.accountType,
    role: payload.role,
  });
}

const canonicalLocalAdminToken = localToken({
  userId: 'local_user_admin_local_admin_example_test',
  tenantId: 'local_tenant_admin_local_admin_example_test',
  email: 'local-admin@example.test',
  accountType: 'admin',
});
identities.set(canonicalLocalAdminToken, {
  userId: 'local_user_admin_local_admin_example_test',
  tenantId: 'local_tenant_admin_local_admin_example_test',
});
const forgedLocalAdminToken = localToken({
  userId: 'ordinary-user-in-admin-tenant',
  tenantId: 'local_tenant_admin_local_admin_example_test',
  email: 'local-admin@example.test',
  accountType: 'admin',
});
identities.set(forgedLocalAdminToken, {
  userId: 'ordinary-user-in-admin-tenant',
  tenantId: 'local_tenant_admin_local_admin_example_test',
});

auth.verifyToken = async authorization => {
  const token = String(authorization || '').replace(/^Bearer\s+/i, '');
  return identities.get(token) ?? null;
};
setAdminIdentityDependenciesForTests({
  getUser: async userId => users.get(userId) ?? null,
  readRegistry: () => structuredClone(registry),
});

const app = express();
app.use('/channels', channelsRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('test server did not bind a TCP port');
const origin = `http://127.0.0.1:${address.port}`;

async function channelInventory(token: string): Promise<number> {
  return (await fetch(`${origin}/channels`, { headers: { Authorization: `Bearer ${token}` } })).status;
}

try {
  for (const [token, reason] of [
    ['same-tenant-peer', 'a missing user must not inherit admin from a shared tenant id'],
    ['ordinary-peer', 'an ordinary user must not inherit admin from a shared tenant id'],
    ['wrong-tenant-admin', 'a registry admin with a conflicting tenant must fail closed'],
    ['mismatched-admin', 'a registry admin with a conflicting provider email must fail closed'],
    ['configured-admin-missing', 'a configured admin email without a trusted user or explicit local identity must fail closed'],
    ['configured-admin-incomplete', 'a provider record missing tenant identity must fail closed'],
    ['tenant-owner', 'an organization super_admin role must not imply platform administration'],
    [forgedLocalAdminToken, 'an admin tenant and email must not authorize a different local user id'],
  ] as const) {
    assert.equal(await channelInventory(token), 403, reason);
  }
  assert.equal(await channelInventory('missing-user-id'), 401, 'a missing authenticated user id must fail closed at authentication');
  assert.equal(await channelInventory('missing-tenant-id'), 401, 'a missing authenticated tenant id must fail closed at authentication');

  assert.equal(await channelInventory('registry-admin'), 200, 'an exact registry admin identity must remain authorized');
  assert.equal(await channelInventory('configured-admin'), 200, 'an exact configured admin email backed by the provider must remain authorized');
  assert.equal(await channelInventory('platform-admin'), 200, 'an explicit provider platform-admin claim must remain authorized');
  assert.equal(await channelInventory(canonicalLocalAdminToken), 200, 'the canonical explicit local administrator must remain authorized');

  console.log('admin identity isolation security tests passed');
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  auth.verifyToken = originalVerifyToken;
  setAdminIdentityDependenciesForTests(null);
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
