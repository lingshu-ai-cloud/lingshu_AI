import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-local-authority-'));
const accountsFile = path.join(temporary, 'local-auth-accounts.json');
const tenantsFile = path.join(temporary, 'local-auth-tenants.json');
const localStoreDir = path.join(temporary, 'local-store');
fs.mkdirSync(localStoreDir, { recursive: true });

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  ENABLE_LOCAL_DEV_FALLBACK: process.env.ENABLE_LOCAL_DEV_FALLBACK,
  DISABLE_LOCAL_AUTH_FALLBACK: process.env.DISABLE_LOCAL_AUTH_FALLBACK,
  LOCAL_DEMO_TOKEN_SECRET: process.env.LOCAL_DEMO_TOKEN_SECRET,
  LOCAL_AUTH_ACCOUNTS_FILE: process.env.LOCAL_AUTH_ACCOUNTS_FILE,
  LOCAL_TENANTS_DATA_FILE: process.env.LOCAL_TENANTS_DATA_FILE,
  LOCAL_STORE_DIR: process.env.LOCAL_STORE_DIR,
  PB_URL: process.env.PB_URL,
  PB_ADMIN_EMAIL: process.env.PB_ADMIN_EMAIL,
  PB_ADMIN_PASSWORD: process.env.PB_ADMIN_PASSWORD,
};

process.env.NODE_ENV = 'test';
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
delete process.env.DISABLE_LOCAL_AUTH_FALLBACK;
process.env.LOCAL_DEMO_TOKEN_SECRET = 'test-only-hmac-secret-with-more-than-thirty-two-bytes';
process.env.LOCAL_AUTH_ACCOUNTS_FILE = accountsFile;
process.env.LOCAL_TENANTS_DATA_FILE = tenantsFile;
process.env.LOCAL_STORE_DIR = localStoreDir;
delete process.env.PB_ADMIN_EMAIL;
delete process.env.PB_ADMIN_PASSWORD;

const tenant = {
  id: 'local_tenant_security',
  name: 'Local Security Tenant',
  companyName: 'Local Security Tenant',
  contactName: '',
  contact: '',
  industry: '',
  notes: '',
  inviteCode: '',
  subscriptionStatus: 'active',
  subscriptionPlan: 'customer',
  subscriptionExpiresAt: null,
  createdAt: '2026-09-14T00:00:00.000Z',
  registeredAt: '2026-09-14T00:00:00.000Z',
  registeredEmail: 'operator@example.test',
};
const account = {
  userId: 'local_user_security',
  tenantId: tenant.id,
  email: 'operator@example.test',
  name: 'Local Operator',
  accountType: 'customer',
  role: 'customer_service',
  salt: 'test-salt',
  passwordHash: 'a'.repeat(128),
  createdAt: '2026-09-14T00:00:00.000Z',
};
fs.writeFileSync(tenantsFile, JSON.stringify([tenant], null, 2), { mode: 0o600 });
fs.writeFileSync(accountsFile, JSON.stringify([account], null, 2), { mode: 0o600 });
fs.writeFileSync(path.join(localStoreDir, 'widgets.json'), JSON.stringify([
  { id: 'local-widget', tenant_id: tenant.id, name: 'local-only' },
], null, 2), { mode: 0o600 });

let pocketBaseMode: 'active' | 'outage' = 'active';
let pocketBaseRequests = 0;
const fakePocketBase = http.createServer((request, response) => {
  pocketBaseRequests += 1;
  if (pocketBaseMode === 'outage') {
    response.statusCode = 503;
    response.end('database unavailable');
    return;
  }
  if (request.url === '/api/collections/users/auth-refresh') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ record: { id: 'pb-user', tenantId: 'pb-tenant' } }));
    return;
  }
  if (request.url?.startsWith('/api/collections/widgets/records?')) {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      items: [{ id: 'pb-widget', tenant_id: 'pb-tenant', name: 'pocketbase-only' }],
      totalItems: 1,
      totalPages: 1,
      page: 1,
      perPage: 20,
    }));
    return;
  }
  response.statusCode = 404;
  response.end('{}');
});

let appServer: http.Server | null = null;
try {
  await new Promise<void>(resolve => fakePocketBase.listen(0, '127.0.0.1', resolve));
  const pocketBaseAddress = fakePocketBase.address();
  if (!pocketBaseAddress || typeof pocketBaseAddress === 'string') throw new Error('fake PocketBase did not bind');
  process.env.PB_URL = `http://127.0.0.1:${pocketBaseAddress.port}`;

  const [
    { issueLocalDemoToken, verifyLocalDemoToken, LOCAL_DEMO_TOKEN_AUDIENCE },
    { pbAuth, pbStore },
    { runInDataAuthorityRequestScope, runWithDataAuthority, currentDataAuthority, LocalAuthorityPocketBaseAccessError },
    { pbGetStrict, getTenantIdFromToken },
    { requestOrganizationRoleStrict },
    { authRouter },
    { createBrowserReadSession },
    { requireAuth },
  ] = await Promise.all([
    import('../auth/localDemoToken.js'),
    import('../storage/pbStore.js'),
    import('../storage/dataAuthority.js'),
    import('../storage/pb.js'),
    import('../lib/organizationRole.js'),
    import('../routes/auth.js'),
    import('../digitalEmployees/browserReadSession.js'),
    import('../middleware/auth.js'),
  ]);

  const signed = issueLocalDemoToken({ userId: account.userId, tenantId: account.tenantId });
  const claims = verifyLocalDemoToken(`Bearer ${signed}`);
  assert.equal(claims?.aud, LOCAL_DEMO_TOKEN_AUDIENCE);
  assert.equal(claims?.sub, account.userId);
  assert.ok(claims?.exp && claims.exp > claims.iat);
  assert.ok(claims?.jti && claims.jti.length >= 16);

  const forged = `${signed.slice(0, -1)}${signed.endsWith('a') ? 'b' : 'a'}`;
  const beforeForged = pocketBaseRequests;
  assert.equal(await runInDataAuthorityRequestScope(() => pbAuth.verifyToken(`Bearer ${forged}`)), null);
  assert.equal(pocketBaseRequests, beforeForged, 'a malformed local token must not be offered to PocketBase');
  const legacyUnsigned = `local-demo.${Buffer.from(JSON.stringify({
    userId: account.userId,
    tenantId: account.tenantId,
    role: 'super_admin',
  })).toString('base64url')}`;
  assert.equal(await runInDataAuthorityRequestScope(() => pbAuth.verifyToken(`Bearer ${legacyUnsigned}`)), null);
  const expired = issueLocalDemoToken(
    { userId: account.userId, tenantId: account.tenantId },
    { nowMs: Date.now() - 5_000, ttlSeconds: 1 },
  );
  assert.equal(await runInDataAuthorityRequestScope(() => pbAuth.verifyToken(`Bearer ${expired}`)), null);
  const missingAccount = issueLocalDemoToken({ userId: 'missing-user', tenantId: account.tenantId });
  assert.equal(await runInDataAuthorityRequestScope(() => pbAuth.verifyToken(`Bearer ${missingAccount}`)), null);
  const missingTenant = issueLocalDemoToken({ userId: account.userId, tenantId: 'missing-tenant' });
  assert.equal(await runInDataAuthorityRequestScope(() => pbAuth.verifyToken(`Bearer ${missingTenant}`)), null);
  assert.equal(
    await runInDataAuthorityRequestScope(() => requestOrganizationRoleStrict(`Bearer ${signed}`, account.userId)),
    'customer_service',
    'authorization must use the persisted role rather than a token claim',
  );

  const requestsBeforeLocalRead = pocketBaseRequests;
  const localRows = await runInDataAuthorityRequestScope(async () => {
    assert.deepEqual(await pbAuth.verifyToken(`Bearer ${signed}`), {
      userId: account.userId,
      tenantId: account.tenantId,
      dataAuthority: 'local',
    });
    const rows = await pbStore.list<{ id: string }>('widgets', { where: { tenant_id: tenant.id } });
    await assert.rejects(() => pbGetStrict('widgets', 'pb-widget'), LocalAuthorityPocketBaseAccessError);
    return rows;
  });
  assert.deepEqual(localRows.items.map(row => row.id), ['local-widget']);
  assert.equal(pocketBaseRequests, requestsBeforeLocalRead, 'local identity must never touch active PocketBase data');

  const requestsBeforeCrossAuthorityAuth = pocketBaseRequests;
  await assert.rejects(
    () => runWithDataAuthority('local', () => getTenantIdFromToken('Bearer second-remote-token')),
    LocalAuthorityPocketBaseAccessError,
  );
  assert.equal(
    pocketBaseRequests,
    requestsBeforeCrossAuthorityAuth,
    'a local-bound request must reject a second remote token before PB cache or network access',
  );

  const browserCredential = createBrowserReadSession({
    tenantId: tenant.id,
    userId: account.userId,
    role: 'customer_service',
    dataAuthority: 'local',
  });
  try {
    const requestsBeforeBrowserRead = pocketBaseRequests;
    const browserRows = await runInDataAuthorityRequestScope(async () => {
      let nextCalled = false;
      let responseStatus = 0;
      await requireAuth(
        {
          headers: { authorization: `Bearer ${browserCredential.token}` },
          method: 'GET',
          originalUrl: '/api/overseas/auth/me',
          url: '/api/overseas/auth/me',
        } as never,
        {
          locals: {},
          status(code: number) { responseStatus = code; return this; },
          json() { return this; },
        } as never,
        (() => { nextCalled = true; }) as never,
      );
      assert.equal(responseStatus, 0);
      assert.equal(nextCalled, true);
      assert.equal(currentDataAuthority(), 'local');
      return pbStore.list<{ id: string }>('widgets', { where: { tenant_id: tenant.id } });
    });
    assert.deepEqual(browserRows.items.map(row => row.id), ['local-widget']);
    assert.equal(
      pocketBaseRequests,
      requestsBeforeBrowserRead,
      'a derived browser-read credential must restore local authority on its new request',
    );
  } finally {
    browserCredential.revoke();
  }

  const remoteRows = await runInDataAuthorityRequestScope(async () => {
    assert.equal((await pbAuth.verifyToken('Bearer remote-token'))?.dataAuthority, 'pocketbase');
    return pbStore.list<{ id: string }>('widgets', { where: { tenant_id: 'pb-tenant' } });
  });
  assert.deepEqual(remoteRows.items.map(row => row.id), ['pb-widget']);

  pocketBaseMode = 'outage';
  const deliveryInvite = 'pb-outage-invite';
  const created = await runWithDataAuthority('local', () => pbStore.create<Record<string, unknown> & { id: string }>('tenants', {
    name: 'Outage Delivery Tenant',
    companyName: 'Outage Delivery Tenant',
    inviteCode: deliveryInvite,
    subscriptionStatus: 'pending_delivery',
    subscriptionPlan: 'delivery',
  }));
  assert.ok(created?.id);
  const listed = await runWithDataAuthority('local', () => pbStore.list<Record<string, unknown> & { id: string }>('tenants', {
    where: { inviteCode: deliveryInvite },
  }));
  assert.equal(listed.totalItems, 1);
  assert.equal(fs.existsSync(path.join(localStoreDir, 'tenants.json')), false, 'tenant writes must use one local registry');

  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  appServer = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => appServer!.once('listening', resolve));
  const address = appServer.address();
  if (!address || typeof address === 'string') throw new Error('test app did not bind');
  const origin = `http://127.0.0.1:${address.port}`;
  const registrationResponse = await fetch(`${origin}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'outage-owner@example.test',
      password: 'StrongPassword!1',
      inviteCode: deliveryInvite,
    }),
  });
  assert.equal(registrationResponse.status, 200);
  const registration = await registrationResponse.json() as { token: string; user: { tenantId: string } };
  assert.equal(registration.user.tenantId, created!.id);
  assert.equal(
    (await runInDataAuthorityRequestScope(() => pbAuth.verifyToken(`Bearer ${registration.token}`)))?.tenantId,
    created!.id,
    'the tenant returned during outage must be immediately registrable and authenticated',
  );
  const activated = JSON.parse(fs.readFileSync(tenantsFile, 'utf8')) as Array<Record<string, unknown>>;
  assert.equal(activated.find(row => row.id === created!.id)?.registrationInviteCode, deliveryInvite);
  assert.equal(activated.find(row => row.id === created!.id)?.inviteCode, '');

  const authSource = fs.readFileSync(new URL('../routes/auth.ts', import.meta.url), 'utf8');
  assert.match(authSource, /pbPatch\('users', identity\.userId,[\s\S]{0,500}?invalidatePbIdentityCache\(\)/);
  assert.match(authSource, /pbPatch\('users', req\.params\.employeeId,[\s\S]{0,300}?invalidatePbIdentityCache\(\)/);
  assert.match(authSource, /pbDelete\('users', req\.params\.employeeId\)[\s\S]{0,300}?invalidatePbIdentityCache\(\)/);

  console.log('local fallback token, authority isolation, and outage registration tests passed');
} finally {
  appServer?.closeAllConnections();
  if (appServer) await new Promise<void>(resolve => appServer!.close(() => resolve()));
  fakePocketBase.closeAllConnections();
  await new Promise<void>(resolve => fakePocketBase.close(() => resolve()));
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(temporary, { recursive: true, force: true });
}
