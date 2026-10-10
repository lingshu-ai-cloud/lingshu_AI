import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {
  LocalAccountStoreError,
  readLocalAccountRecords,
  writeLocalAccountRecords,
  type LocalStoredAccount,
} from '../lib/localAccountStore.js';

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-local-account-store-'));
const missingFile = path.join(temporaryDirectory, 'missing.json');
const accountsFile = path.join(temporaryDirectory, 'local-auth-accounts.json');
const tenantsFile = path.join(temporaryDirectory, 'local-auth-tenants.json');
const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  DISABLE_LOCAL_AUTH_FALLBACK: process.env.DISABLE_LOCAL_AUTH_FALLBACK,
  LOCAL_AUTH_ACCOUNTS_FILE: process.env.LOCAL_AUTH_ACCOUNTS_FILE,
  LOCAL_TENANTS_DATA_FILE: process.env.LOCAL_TENANTS_DATA_FILE,
  PB_URL: process.env.PB_URL,
};

const validAccount: LocalStoredAccount = {
  userId: 'local-user-1',
  tenantId: 'local-tenant-1',
  email: 'owner@example.test',
  name: 'Owner',
  accountType: 'customer',
  role: 'super_admin',
  salt: 'test-salt',
  passwordHash: 'a'.repeat(128),
  createdAt: '2026-09-12T00:00:00.000Z',
};

let fakePocketBase: http.Server | null = null;
let applicationServer: http.Server | null = null;
try {
  assert.deepEqual(readLocalAccountRecords(missingFile), [], 'only ENOENT should be treated as an empty registry');
  writeLocalAccountRecords(accountsFile, [validAccount]);
  assert.deepEqual(readLocalAccountRecords(accountsFile), [validAccount]);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(accountsFile).mode & 0o777, 0o600, 'account registry must be owner-readable only');
  }
  assert.equal(fs.readdirSync(temporaryDirectory).some(name => name.endsWith('.tmp')), false);

  const malformedBytes = '{"truncated":';
  fs.writeFileSync(accountsFile, malformedBytes, { mode: 0o600 });
  const malformedMtime = fs.statSync(accountsFile, { bigint: true }).mtimeNs;
  assert.throws(
    () => readLocalAccountRecords(accountsFile),
    (error: unknown) => error instanceof LocalAccountStoreError && error.code === 'local_account_store_unavailable',
  );
  assert.equal(fs.readFileSync(accountsFile, 'utf8'), malformedBytes);
  assert.equal(fs.statSync(accountsFile, { bigint: true }).mtimeNs, malformedMtime, 'failed reads must never rewrite malformed storage');

  fs.writeFileSync(tenantsFile, JSON.stringify([{
    id: 'local-tenant-1',
    name: 'Tenant One',
    companyName: 'Tenant One',
    contactName: '',
    contact: '',
    industry: '',
    notes: '',
    inviteCode: 'safe-invite',
    subscriptionStatus: 'pending_delivery',
    subscriptionPlan: 'delivery',
    subscriptionExpiresAt: null,
    createdAt: '2026-09-12T00:00:00.000Z',
  }], null, 2), { mode: 0o600 });

  fakePocketBase = http.createServer((_request, response) => {
    response.statusCode = 503;
    response.end('{}');
  });
  await new Promise<void>(resolve => fakePocketBase!.listen(0, '127.0.0.1', resolve));
  const pocketBaseAddress = fakePocketBase.address();
  if (!pocketBaseAddress || typeof pocketBaseAddress === 'string') throw new Error('fake PocketBase did not bind');

  process.env.NODE_ENV = 'test';
  process.env.DISABLE_LOCAL_AUTH_FALLBACK = 'false';
  process.env.LOCAL_AUTH_ACCOUNTS_FILE = accountsFile;
  process.env.LOCAL_TENANTS_DATA_FILE = tenantsFile;
  process.env.PB_URL = `http://127.0.0.1:${pocketBaseAddress.port}`;
  const { authRouter } = await import('../routes/auth.js');
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  applicationServer = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => applicationServer!.once('listening', resolve));
  const address = applicationServer.address();
  if (!address || typeof address === 'string') throw new Error('test application did not bind');

  const response = await fetch(`http://127.0.0.1:${address.port}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'new@example.test', password: 'StrongPassword!1', inviteCode: 'safe-invite' }),
  });
  assert.equal(response.status, 503, 'corrupt account storage must fail closed with a stable service status');
  assert.deepEqual(await response.json(), {
    error: 'local_auth_store_unavailable',
    message: '本地认证数据暂时不可用，请联系管理员修复后重试。',
  });
  assert.equal(fs.readFileSync(accountsFile, 'utf8'), malformedBytes, 'registration must not overwrite malformed account bytes');
  assert.equal(fs.statSync(accountsFile, { bigint: true }).mtimeNs, malformedMtime);
  assert.equal(fs.readdirSync(temporaryDirectory).some(name => name.endsWith('.tmp')), false);

  console.log('local account registry persistence tests passed');
} finally {
  applicationServer?.closeAllConnections();
  if (applicationServer) await new Promise<void>(resolve => applicationServer!.close(() => resolve()));
  fakePocketBase?.closeAllConnections();
  if (fakePocketBase) await new Promise<void>(resolve => fakePocketBase!.close(() => resolve()));
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
