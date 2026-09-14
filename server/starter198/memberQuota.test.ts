import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { ListQuery } from '../storage/datastore.js';

const previous = {
  NODE_ENV: process.env.NODE_ENV,
  DISABLE_LOCAL_AUTH_FALLBACK: process.env.DISABLE_LOCAL_AUTH_FALLBACK,
  LOCAL_AUTH_ACCOUNTS_FILE: process.env.LOCAL_AUTH_ACCOUNTS_FILE,
  PB_URL: process.env.PB_URL,
};
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-member-quota-'));
const accountsFile = path.join(directory, 'accounts.json');
process.env.NODE_ENV = 'test';
process.env.DISABLE_LOCAL_AUTH_FALLBACK = 'false';
process.env.LOCAL_AUTH_ACCOUNTS_FILE = accountsFile;
process.env.PB_URL = 'http://127.0.0.1:1';

const starterTenant = 'starter-members-a';
const legacyTenant = 'legacy-members-b';
const account = (tenantId: string, suffix: string) => ({
  userId: `owner-${suffix}`, tenantId, email: `owner-${suffix}@example.com`, name: `Owner ${suffix}`,
  accountType: 'customer' as const, role: 'super_admin' as const, salt: 'aa', passwordHash: 'bb',
  createdAt: '2026-09-12T00:00:00.000Z',
});
fs.writeFileSync(accountsFile, JSON.stringify([account(starterTenant, 'a'), account(legacyTenant, 'b')]), { mode: 0o600 });

const [{ authRouter }, { store }, { STARTER_198_CAPABILITIES, STARTER_198_PROFILE_VERSION }] = await Promise.all([
  import('../routes/auth.js'),
  import('../storage/index.js'),
  import('../../shared/contracts/starter198.js'),
]);
const originalList = store.list;
let accessFailure = false;
store.list = (async (collection: string, query: ListQuery = {}) => {
  if (collection !== 'starter_198_access') return originalList.call(store, collection, query);
  if (accessFailure) throw new Error('database unavailable');
  const tenantId = String(query.where?.tenant_id ?? '');
  const items = tenantId === starterTenant ? [{
    id: 'access-members-a', tenant_id: starterTenant, product_profile: 'starter_198',
    profile_version: STARTER_198_PROFILE_VERSION, entitlement_snapshot_id: 'members-snapshot-a',
    feature_entitlements: STARTER_198_CAPABILITIES.map(capability => ({ capability, enabled: true })),
    resource_limits: {
      workspaceCount: 1, brandCount: 1, memberCount: 2, agentTeamCount: 1,
      productCount: 1, marketCount: 1, buyerPersonaCount: 1, languageCount: 1,
      primaryPlatformCount: 1, concurrentRunCount: 1, contentArtifactCountPerCycle: 2,
      contentRevisionCountPerCycle: 1, publicationPackageCountPerContent: 1,
      assistedSessionCount: 0, inquiryAiCountPerCycle: 10, quoteDraftCountPerCycle: 10,
      highCostVideoCount: 0, budgetCnyPerCycle: 100,
      agentBudgetCny: { orchestrator: 25, content: 25, traffic: 25, sales: 25 },
    },
    status: 'active', cycle_started_at: '2026-09-12T00:00:00.000Z',
    cycle_ends_at: '2026-09-19T00:00:00.000Z', updated_at: '2026-09-12T00:00:00.000Z',
  }] : [];
  return { items, totalItems: items.length, totalPages: items.length ? 1 : 0, page: 1, perPage: 2 };
}) as typeof store.list;

const app = express();
app.use(express.json());
app.use('/api/overseas/auth', authRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('member quota test server did not bind');
const origin = `http://127.0.0.1:${address.port}`;
const token = (tenantId: string, suffix: string) => `local-demo.${Buffer.from(JSON.stringify({
  userId: `owner-${suffix}`, tenantId, email: `owner-${suffix}@example.com`, name: `Owner ${suffix}`,
  accountType: 'customer', role: 'super_admin',
})).toString('base64url')}`;
const add = (tenantId: string, suffix: string, email: string) => fetch(`${origin}/api/overseas/auth/employees`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token(tenantId, suffix)}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, name: email.split('@')[0], password: 'Password-123', role: 'customer_service' }),
});

try {
  assert.equal((await add(starterTenant, 'a', 'second-a@example.com')).status, 201);
  const atLimit = fs.readFileSync(accountsFile);
  const denied = await add(starterTenant, 'a', 'third-a@example.com');
  assert.equal(denied.status, 409);
  assert.equal((await denied.json() as { error: string }).error, 'starter_198_member_quota_exceeded');
  assert.deepEqual(fs.readFileSync(accountsFile), atLimit, 'quota denial must not mutate local accounts');

  accessFailure = true;
  const unavailable = await add(starterTenant, 'a', 'fourth-a@example.com');
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json() as { error: string }).error, 'starter_198_member_quota_unavailable');
  assert.deepEqual(fs.readFileSync(accountsFile), atLimit, 'access failure must fail closed without member writes');

  accessFailure = false;
  assert.equal((await add(legacyTenant, 'b', 'second-b@example.com')).status, 201,
    'an unprovisioned legacy tenant must keep its prior employee behavior');
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  store.list = originalList;
  fs.rmSync(directory, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}

console.log('starter_198 member quota passed: exact tenant count, limit denial, storage fail-closed, legacy compatibility');
