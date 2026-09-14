import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  LOCAL_TENANTS_DATA_FILE: process.env.LOCAL_TENANTS_DATA_FILE,
};
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-local-tenant-registry-'));
const registryFile = path.join(temporaryDirectory, 'local-auth-tenants.json');
const legacyRegistry = [
  {
    id: 'tenant-target',
    name: 'Target tenant',
    companyName: 'Target tenant',
    contactName: '',
    contact: '',
    industry: '',
    notes: '',
    inviteCode: '',
    subscriptionStatus: 'active',
    subscriptionPlan: 'customer',
    subscriptionExpiresAt: null,
    createdAt: '2026-09-12T00:00:00.000Z',
    registeredAt: '2026-09-12T00:00:00.000Z',
    registeredEmail: 'target@example.test',
    registeredPasswordCipher: 'v1:target-legacy-cipher',
  },
  {
    id: 'tenant-other',
    name: 'Other tenant',
    companyName: 'Other tenant',
    contactName: '',
    contact: '',
    industry: '',
    notes: '',
    inviteCode: '',
    subscriptionStatus: 'active',
    subscriptionPlan: 'customer',
    subscriptionExpiresAt: null,
    createdAt: '2026-09-12T00:00:00.000Z',
    registeredAt: '2026-09-12T00:00:00.000Z',
    registeredEmail: 'other@example.test',
    registeredPasswordCipher: 'v1:other-legacy-cipher',
  },
];
const originalBytes = JSON.stringify(legacyRegistry, null, 2);
fs.writeFileSync(registryFile, originalBytes, { mode: 0o600 });

process.env.NODE_ENV = 'test';
process.env.LOCAL_TENANTS_DATA_FILE = registryFile;

const {
  clearLocalTenantRegisteredCredential,
  createLocalInviteTenant,
  getLocalTenant,
  listLocalTenants,
} = await import('../lib/localTenants.js');

try {
  const mtimeBeforeRead = fs.statSync(registryFile, { bigint: true }).mtimeNs;
  const listed = listLocalTenants();
  const fetched = getLocalTenant('tenant-target');
  assert.ok(listed.length === 2 && fetched);
  assert.ok(listed.every(record => !Object.hasOwn(record, 'registeredPasswordCipher')));
  assert.equal(Object.hasOwn(fetched!, 'registeredPasswordCipher'), false);
  assert.equal(fs.readFileSync(registryFile, 'utf8'), originalBytes, 'ordinary reads must preserve source bytes');
  assert.equal(fs.statSync(registryFile, { bigint: true }).mtimeNs, mtimeBeforeRead, 'ordinary reads must preserve source mtime');

  const beforeWrongIdentity = fs.readFileSync(registryFile, 'utf8');
  assert.equal(clearLocalTenantRegisteredCredential('tenant-target', 'wrong@example.test'), false);
  assert.equal(fs.readFileSync(registryFile, 'utf8'), beforeWrongIdentity, 'a non-matching identity must not alter the registry');

  createLocalInviteTenant({ companyName: 'New tenant', inviteCode: 'new-invite' });
  const afterMetadataWrite = JSON.parse(fs.readFileSync(registryFile, 'utf8')) as Array<Record<string, unknown>>;
  assert.equal(afterMetadataWrite.find(record => record.id === 'tenant-target')?.registeredPasswordCipher, 'v1:target-legacy-cipher');
  assert.equal(afterMetadataWrite.find(record => record.id === 'tenant-other')?.registeredPasswordCipher, 'v1:other-legacy-cipher');
  assert.equal(Object.hasOwn(afterMetadataWrite[0], 'registeredPasswordCipher'), false, 'new records must never gain a recoverable credential');

  assert.equal(clearLocalTenantRegisteredCredential('tenant-target', 'TARGET@example.test'), true);
  const afterTargetedClear = JSON.parse(fs.readFileSync(registryFile, 'utf8')) as Array<Record<string, unknown>>;
  assert.equal(Object.hasOwn(afterTargetedClear.find(record => record.id === 'tenant-target')!, 'registeredPasswordCipher'), false);
  assert.equal(afterTargetedClear.find(record => record.id === 'tenant-other')?.registeredPasswordCipher, 'v1:other-legacy-cipher', 'targeted cleanup must not scrub another account');
  assert.equal(fs.statSync(registryFile).mode & 0o777, 0o600);

  const bytesBeforeIdempotentClear = fs.readFileSync(registryFile, 'utf8');
  const mtimeBeforeIdempotentClear = fs.statSync(registryFile, { bigint: true }).mtimeNs;
  assert.equal(clearLocalTenantRegisteredCredential('tenant-target', 'target@example.test'), true);
  assert.equal(fs.readFileSync(registryFile, 'utf8'), bytesBeforeIdempotentClear);
  assert.equal(fs.statSync(registryFile, { bigint: true }).mtimeNs, mtimeBeforeIdempotentClear, 'idempotent cleanup must not rewrite the file');

  const malformed = '{not-valid-json';
  fs.writeFileSync(registryFile, malformed, { mode: 0o600 });
  assert.throws(() => listLocalTenants(), /Cannot read local tenant registry/);
  assert.throws(() => createLocalInviteTenant({ companyName: 'Must not overwrite', inviteCode: 'blocked' }), /Cannot read local tenant registry/);
  assert.equal(fs.readFileSync(registryFile, 'utf8'), malformed, 'malformed registry data must never be treated as an empty writable store');

  console.log('local tenant registry persistence tests passed');
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
