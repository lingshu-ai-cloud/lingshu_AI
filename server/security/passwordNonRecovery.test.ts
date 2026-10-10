import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import {
  sanitizeDemoAccountRegistryEntry,
} from '../lib/demoAccounts.js';
import { sanitizeLocalTenantRecord } from '../lib/localTenants.js';
import {
  decryptRegistrationPassword,
  encryptRegistrationPassword,
} from '../lib/registrationCredentials.js';
import { auth } from '../storage/index.js';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

const sanitizedTrial = sanitizeDemoAccountRegistryEntry({
  email: 'Legacy-Trial@Example.Test',
  password: 'recoverable-password',
  rotationPassword: 'recoverable-rotation',
  registeredPasswordCipher: 'v1:recoverable-registration-cipher',
  status: 'trialing',
  userId: 'legacy-user',
});
assert.equal(sanitizedTrial.email, 'legacy-trial@example.test');
assert.equal(Object.hasOwn(sanitizedTrial, 'password'), false, 'registry sanitizer must remove plaintext passwords');
assert.equal(Object.hasOwn(sanitizedTrial, 'rotationPassword'), false, 'registry sanitizer must remove rotated passwords');
assert.equal(Object.hasOwn(sanitizedTrial, 'registeredPasswordCipher'), false, 'registry sanitizer must remove registration ciphertext');
assert.equal(
  sanitizedTrial.credentialState,
  'password_reset_required',
  'legacy recoverable credentials must become an explicit reset requirement',
);

const sanitizedExpired = sanitizeDemoAccountRegistryEntry({
  email: 'expired@example.test',
  rotationPassword: 'legacy-rotation',
  status: 'expired',
  rotatedAt: '2026-09-12T00:00:00.000Z',
});
assert.equal(sanitizedExpired.credentialState, 'expired_locked');
assert.equal(Object.hasOwn(sanitizedExpired, 'rotationPassword'), false);

const sanitizedTenant = sanitizeLocalTenantRecord({
  id: 'tenant-legacy',
  name: 'Legacy tenant',
  companyName: 'Legacy tenant',
  contactName: '',
  contact: '',
  industry: '',
  notes: '',
  inviteCode: '',
  subscriptionStatus: 'active',
  subscriptionPlan: 'customer',
  subscriptionExpiresAt: null,
  createdAt: '2026-09-12T00:00:00.000Z',
  registeredPasswordCipher: 'v1:recoverable-ciphertext',
});
assert.equal(
  Object.hasOwn(sanitizedTenant, 'registeredPasswordCipher'),
  false,
  'local tenant reads and writes must discard historical recoverable credentials',
);

assert.equal(
  decryptRegistrationPassword('legacy-cleartext-or-ciphertext'),
  '',
  'historical credentials must never be decrypted or returned',
);
assert.throws(
  () => encryptRegistrationPassword('new-password'),
  /must not be persisted/,
  'compatibility API must fail closed if a future caller tries to persist a password',
);

const credentialSource = read('server/lib/registrationCredentials.ts');
assert.doesNotMatch(credentialSource, /createCipheriv|createDecipheriv|aes-256-gcm/, 'registration credential module must contain no reversible encryption path');

const authSource = read('server/routes/auth.ts');
assert.doesNotMatch(authSource, /encryptRegistrationPassword/, 'registration, login and password change must not encrypt customer passwords');
assert.doesNotMatch(authSource, /registeredPasswordCipher/, 'auth flows must not depend on the removed credential field');
assert.doesNotMatch(authSource, /registryEntry\??\.password/, 'local login must not authenticate against registry plaintext');
assert.doesNotMatch(authSource, /upsertDemoAccountRegistry\([\s\S]{0,220}\bpassword\s*:/, 'auth flows must not copy passwords into the registry');
assert.match(authSource, /passwordHash:\s*passwordHash\(password, salt\)/, 'local customer login must retain one-way password hashing');

const adminSource = read('server/routes/admin.ts');
assert.doesNotMatch(adminSource, /decryptRegistrationPassword/, 'admin routes must not recover historical passwords');
assert.doesNotMatch(adminSource, /registeredPasswordCipher/, 'admin flows must not depend on the removed credential field');
const demoAccountsRoute = adminSource.slice(
  adminSource.indexOf("adminRouter.get('/demo-accounts'"),
  adminSource.indexOf("adminRouter.post('/trial-accounts/:tenantId/promote'"),
);
assert.ok(demoAccountsRoute.length > 0, 'demo accounts response route must be present');
assert.doesNotMatch(demoAccountsRoute, /\bpassword\s*:/, 'demo accounts response contract must not include password');
assert.doesNotMatch(demoAccountsRoute, /rotationPassword/, 'demo accounts response contract must not include rotationPassword');
assert.match(demoAccountsRoute, /credentialState/, 'demo accounts response must expose non-secret credential state');
assert.match(demoAccountsRoute, /credentialAction/, 'demo accounts response must explain the reset action');

const dashboardSource = read('src/components/AdminDashboard.tsx');
assert.doesNotMatch(dashboardSource, /account\.password|rotationPassword|>初始密码</, 'admin UI must not render recoverable credentials');
assert.match(dashboardSource, /凭据状态 \/ 重置说明/, 'admin UI must render credential state and reset guidance');

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  PB_URL: process.env.PB_URL,
  PB_ADMIN_EMAIL: process.env.PB_ADMIN_EMAIL,
  PB_ADMIN_PASSWORD: process.env.PB_ADMIN_PASSWORD,
  ADMIN_DASHBOARD_EMAILS: process.env.ADMIN_DASHBOARD_EMAILS,
  DEMO_ALLOWED_ACCOUNTS: process.env.DEMO_ALLOWED_ACCOUNTS,
};
const originalVerifyToken = auth.verifyToken;
const pbRequests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
const initialPassword = 'Initial!234';
const changedPassword = 'Changed!567';
const tenant: Record<string, unknown> = {
  id: 'tenant-password-contract',
  name: 'Password Contract Customer',
  companyName: 'Password Contract Customer',
  inviteCode: 'invite-password-contract',
  registrationInviteCode: '',
  registeredEmail: '',
  registeredPasswordCipher: 'v1:historical-ciphertext',
  subscriptionStatus: 'pending_delivery',
  subscriptionPlan: 'delivery',
  subscriptionExpiresAt: null,
  createdAt: '2026-09-12T00:00:00.000Z',
};
let customerUser: Record<string, unknown> | null = null;
let registrationLease: Record<string, unknown> | null = null;

const pbApp = express();
pbApp.use(express.json());
pbApp.post('/api/collections/_superusers/auth-with-password', (_req, res) => res.json({ token: 'admin-contract-token' }));
pbApp.post('/api/admins/auth-with-password', (_req, res) => res.json({ token: 'admin-contract-token' }));
pbApp.post('/api/collections/users/auth-with-password', (req, res) => {
  const identity = String(req.body?.identity || '').toLowerCase();
  if (!customerUser || identity !== customerUser.email || req.body?.password !== customerUser.password) {
    res.status(400).json({ error: 'invalid_credentials' });
    return;
  }
  res.json({ token: 'customer-contract-token', record: customerUser });
});
pbApp.get('/api/collections/:collection/records', (req, res) => {
  const collection = req.params.collection;
  const filter = String(req.query.filter || '');
  let items: Record<string, unknown>[] = [];
  if (collection === 'tenants') {
    items = filter.includes('inviteCode')
      ? (tenant.inviteCode === 'invite-password-contract' ? [tenant] : [])
      : [tenant];
  } else if (collection === 'users') {
    const users = [
      ...(customerUser ? [customerUser] : []),
      { id: 'admin-password-contract', email: 'admin@example.test', tenantId: 'admin-tenant' },
    ];
    const tenantMatch = filter.match(/tenantId\s*=\s*"([^"]+)"/);
    items = users.filter(user => !tenantMatch || user.tenantId === tenantMatch[1]);
    if (filter.includes('role = "super_admin"')) items = items.filter(user => user.role === 'super_admin');
  } else if (collection === 'durable_operation_leases' && registrationLease) {
    items = [registrationLease];
  }
  res.json({ items, totalItems: items.length, totalPages: 1, page: 1, perPage: 500 });
});
pbApp.post('/api/collections/users/records', (req, res) => {
  pbRequests.push({ method: 'POST', path: req.path, body: req.body });
  customerUser = {
    id: 'user-password-contract',
    email: String(req.body?.email || '').toLowerCase(),
    name: req.body?.name,
    tenantId: req.body?.tenantId,
    role: req.body?.role,
    password: req.body?.password,
  };
  res.status(200).json(customerUser);
});
pbApp.post('/api/collections/durable_operation_leases/records', (req, res) => {
  if (registrationLease) { res.status(400).json({ error: 'duplicate' }); return; }
  registrationLease = { ...req.body, id: 'invite-registration-lease' };
  res.status(200).json(registrationLease);
});
pbApp.get('/api/collections/:collection/records/:id', (req, res) => {
  if (req.params.collection === 'tenants' && req.params.id === tenant.id) {
    res.json(tenant);
    return;
  }
  if (req.params.collection === 'users' && req.params.id === customerUser?.id) {
    res.json(customerUser);
    return;
  }
  if (req.params.collection === 'users' && req.params.id === 'admin-password-contract') {
    res.json({ id: 'admin-password-contract', email: 'admin@example.test', tenantId: 'admin-tenant' });
    return;
  }
  if (req.params.collection === 'durable_operation_leases' && req.params.id === registrationLease?.id) {
    res.json(registrationLease);
    return;
  }
  res.status(404).json({ error: 'not_found' });
});
pbApp.patch('/api/collections/:collection/records/:id', (req, res) => {
  pbRequests.push({ method: 'PATCH', path: req.path, body: req.body });
  if (req.params.collection === 'tenants' && req.params.id === tenant.id) Object.assign(tenant, req.body);
  if (req.params.collection === 'users' && req.params.id === customerUser?.id && customerUser) Object.assign(customerUser, req.body);
  res.json({ ok: true });
});
pbApp.delete('/api/collections/durable_operation_leases/records/:id', (req, res) => {
  if (req.params.id !== registrationLease?.id) { res.status(404).json({ error: 'not_found' }); return; }
  registrationLease = null;
  res.status(204).end();
});

const pbServer = pbApp.listen(0, '127.0.0.1');
await new Promise<void>(resolve => pbServer.once('listening', resolve));
const pbAddress = pbServer.address();
if (!pbAddress || typeof pbAddress === 'string') throw new Error('fake PocketBase did not bind a port');

process.env.NODE_ENV = 'test';
process.env.PB_URL = `http://127.0.0.1:${pbAddress.port}`;
process.env.PB_ADMIN_EMAIL = 'pb-admin@example.test';
process.env.PB_ADMIN_PASSWORD = 'pb-admin-contract-secret';
process.env.ADMIN_DASHBOARD_EMAILS = 'admin@example.test';
process.env.DEMO_ALLOWED_ACCOUNTS = 'trial@example.test';

const [{ authRouter }, { adminRouter }] = await Promise.all([
  import('../routes/auth.js'),
  import('../routes/admin.js'),
]);
const apiApp = express();
apiApp.use(express.json());
apiApp.use('/auth', authRouter);
apiApp.use('/admin', adminRouter);
const apiServer = apiApp.listen(0, '127.0.0.1');
await new Promise<void>(resolve => apiServer.once('listening', resolve));
const apiAddress = apiServer.address();
if (!apiAddress || typeof apiAddress === 'string') throw new Error('test API did not bind a port');
const apiOrigin = `http://127.0.0.1:${apiAddress.port}`;

async function jsonRequest(pathname: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${apiOrigin}${pathname}`, init);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

function sensitiveKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(sensitiveKeys);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, nested]) => [
    ...(['password', 'rotationPassword'].includes(key) ? [key] : []),
    ...sensitiveKeys(nested),
  ]);
}

try {
  const registration = await jsonRequest('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'customer@example.test',
      password: initialPassword,
      inviteCode: 'invite-password-contract',
    }),
  });
  assert.equal(registration.status, 200, 'formal registration should still succeed');
  const registrationTenantPatch = pbRequests.find(request => request.method === 'PATCH' && request.path.endsWith('/tenants/records/tenant-password-contract'));
  assert.equal(Object.hasOwn(registrationTenantPatch?.body ?? {}, 'registeredPasswordCipher'), false, 'registration must not write the removed credential field');
  assert.doesNotMatch(JSON.stringify(registrationTenantPatch?.body), new RegExp(initialPassword), 'registration password must not reach the tenant record');

  const patchesBeforeLogin = pbRequests.length;
  const login = await jsonRequest('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'customer@example.test', password: initialPassword }),
  });
  assert.equal(login.status, 200, 'hash-provider customer login should still succeed');
  const loginPatches = pbRequests.slice(patchesBeforeLogin).filter(request => request.method === 'PATCH');
  assert.ok(loginPatches.every(request => !Object.hasOwn(request.body, 'registeredPasswordCipher')), 'verified login must not write the removed credential field');
  assert.ok(loginPatches.every(request => !JSON.stringify(request.body).includes(initialPassword)), 'login synchronization must not persist the verified password');

  auth.verifyToken = async () => ({ userId: 'user-password-contract', tenantId: 'tenant-password-contract' });
  const patchesBeforeChange = pbRequests.length;
  const changed = await jsonRequest('/auth/change-password', {
    method: 'POST',
    headers: { Authorization: 'Bearer customer-contract-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: initialPassword, newPassword: changedPassword, passwordConfirm: changedPassword }),
  });
  assert.equal(changed.status, 200, 'password change should retain authentication-provider behavior');
  const changePatches = pbRequests.slice(patchesBeforeChange).filter(request => request.method === 'PATCH');
  const userPasswordPatch = changePatches.find(request => request.path.endsWith('/users/records/user-password-contract'));
  assert.equal(userPasswordPatch?.body.password, changedPassword, 'new password must still reach the authentication provider');
  const nonUserPasswordWrites = changePatches.filter(request => !request.path.includes('/users/records/'));
  assert.ok(nonUserPasswordWrites.every(request => !JSON.stringify(request.body).includes(changedPassword)), 'new password must not be copied outside the authentication provider');
  assert.ok(nonUserPasswordWrites.every(request => !Object.hasOwn(request.body, 'registeredPasswordCipher')), 'password change must not write the removed credential field');

  auth.verifyToken = async () => ({ userId: 'admin-password-contract', tenantId: 'admin-tenant' });
  const adminAccounts = await jsonRequest('/admin/demo-accounts', {
    headers: { Authorization: 'Bearer admin-contract-token' },
  });
  assert.equal(adminAccounts.status, 200, 'authorized admin account listing should succeed');
  assert.deepEqual(sensitiveKeys(adminAccounts.body), [], 'admin account response must contain no password fields at any depth');
  const trialAccounts = adminAccounts.body.trialAccounts as Array<Record<string, unknown>>;
  const customerAccounts = adminAccounts.body.customerAccounts as Array<Record<string, unknown>>;
  assert.ok(trialAccounts.every(account => account.credentialState && account.credentialAction), 'trial response must provide credential state and reset guidance');
  assert.ok(customerAccounts.every(account => account.credentialState && account.credentialAction), 'customer response must provide credential state and reset guidance');
} finally {
  auth.verifyToken = originalVerifyToken;
  apiServer.closeAllConnections();
  pbServer.closeAllConnections();
  await Promise.all([
    new Promise<void>(resolve => apiServer.close(() => resolve())),
    new Promise<void>(resolve => pbServer.close(() => resolve())),
  ]);
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log('password non-recovery security tests passed');
