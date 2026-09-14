import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  DISABLE_LOCAL_AUTH_FALLBACK: process.env.DISABLE_LOCAL_AUTH_FALLBACK,
  LOCAL_AUTH_ACCOUNTS_FILE: process.env.LOCAL_AUTH_ACCOUNTS_FILE,
};
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-password-change-'));
const accountsFile = path.join(temporaryDirectory, 'local-auth-accounts.json');
const email = 'partial-success@example.test';
const userId = 'partial-success-user';
const tenantId = 'partial-success-tenant';
const currentPassword = 'Current!234';
const newPassword = 'Changed!567';
const salt = 'route-test-salt';

fs.writeFileSync(accountsFile, JSON.stringify([{
  userId,
  tenantId,
  email,
  name: 'Partial Success',
  accountType: 'customer',
  role: 'super_admin',
  salt,
  passwordHash: scryptSync(currentPassword, salt, 64).toString('hex'),
  createdAt: '2026-09-12T00:00:00.000Z',
}], null, 2), { mode: 0o600 });

process.env.NODE_ENV = 'test';
process.env.DISABLE_LOCAL_AUTH_FALLBACK = 'false';
process.env.LOCAL_AUTH_ACCOUNTS_FILE = accountsFile;

const [{
  setPasswordChangeCredentialStateDependenciesForTests,
  syncPasswordChangeCredentialStateBestEffort,
}, { authRouter }] = await Promise.all([
  import('../lib/passwordChangeCredentialState.js'),
  import('../routes/auth.js'),
]);

const helperWarnings: Array<{ message: string; details: Record<string, string> }> = [];
for (const branch of ['local', 'provider'] as const) {
  const operations: string[] = [];
  assert.doesNotThrow(() => {
    assert.equal(syncPasswordChangeCredentialStateBestEffort(
      `${branch}@example.test`,
      { branch, tenantId: `tenant-${branch}`, userId: `user-${branch}` },
      {
        clearLocalTenantCredential: () => {
          operations.push('local_tenant_credential_cleanup');
          throw new Error('fixture cleanup failure containing a credential');
        },
        readRegistry: () => ({
          [`${branch}@example.test`]: {
            email: `${branch}@example.test`,
            userId: `user-${branch}`,
            credentialState: 'active_hash_only',
          },
        }),
        writeRegistry: () => {
          operations.push('demo_registry_state_sync');
          throw new Error('fixture registry failure containing a credential');
        },
        warn: (message, details) => helperWarnings.push({ message, details }),
      },
    ), false, `${branch} derived metadata failure must be best-effort`);
  });
  assert.deepEqual(
    operations,
    branch === 'local'
      ? ['local_tenant_credential_cleanup', 'demo_registry_state_sync']
      : ['demo_registry_state_sync'],
  );
}

const routeWarnings: Array<{ message: string; details: Record<string, string> }> = [];
setPasswordChangeCredentialStateDependenciesForTests({
  clearLocalTenantCredential: () => {
    throw new Error(`must not log ${currentPassword}`);
  },
  readRegistry: () => ({
    [email]: { email, userId, tenantId, status: 'customer', credentialState: 'active_hash_only' },
  }),
  writeRegistry: () => {
    throw new Error(`must not log ${email} or ${newPassword}`);
  },
  warn: (message, details) => routeWarnings.push({ message, details }),
});

const app = express();
app.use(express.json());
app.use('/auth', authRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('test server did not bind a TCP port');
const token = `local-demo.${Buffer.from(JSON.stringify({
  userId,
  tenantId,
  email,
  accountType: 'customer',
  role: 'super_admin',
}), 'utf8').toString('base64url')}`;

try {
  const response = await fetch(`http://127.0.0.1:${address.port}/auth/change-password`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword, passwordConfirm: newPassword }),
  });
  assert.equal(response.status, 200, 'derived-store failures after a local password update must not become an ambiguous 500');
  assert.deepEqual(await response.json(), { ok: true });

  const [updatedAccount] = JSON.parse(fs.readFileSync(accountsFile, 'utf8')) as Array<{ salt: string; passwordHash: string }>;
  assert.equal(
    updatedAccount.passwordHash,
    scryptSync(newPassword, updatedAccount.salt, 64).toString('hex'),
    'the authentication hash must remain updated when derived metadata cleanup fails',
  );
  assert.notEqual(
    updatedAccount.passwordHash,
    scryptSync(currentPassword, updatedAccount.salt, 64).toString('hex'),
    'the previous password must no longer authenticate',
  );

  assert.deepEqual(
    routeWarnings.map(item => item.details.operation).sort(),
    ['demo_registry_state_sync', 'local_tenant_credential_cleanup'],
  );
  for (const warning of [...helperWarnings, ...routeWarnings]) {
    const serialized = JSON.stringify(warning);
    assert.equal(warning.details.event, 'password_change_derived_credential_state_sync_failed');
    assert.equal(warning.details.errorType, 'Error');
    assert.doesNotMatch(serialized, /@example\.test|Current!234|Changed!567|fixture .* failure|must not log/i);
  }

  console.log('password change partial-success tests passed');
} finally {
  setPasswordChangeCredentialStateDependenciesForTests(null);
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
