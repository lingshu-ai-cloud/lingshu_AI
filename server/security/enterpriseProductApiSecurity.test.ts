import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  PB_URL: process.env.PB_URL,
  DISABLE_LOCAL_AUTH_FALLBACK: process.env.DISABLE_LOCAL_AUTH_FALLBACK,
  LOCAL_STORE_DIR: process.env.LOCAL_STORE_DIR,
  DEMO_MODE: process.env.DEMO_MODE,
  PRODUCT_API_KEY_PEPPER: process.env.PRODUCT_API_KEY_PEPPER,
};
const originalCwd = process.cwd();
const temporaryCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-enterprise-product-api-security-'));

process.chdir(temporaryCwd);
process.env.NODE_ENV = 'test';
process.env.PB_URL = 'http://127.0.0.1:1';
process.env.DISABLE_LOCAL_AUTH_FALLBACK = 'false';
process.env.LOCAL_STORE_DIR = path.join(temporaryCwd, 'local-store');
process.env.DEMO_MODE = 'true';
process.env.PRODUCT_API_KEY_PEPPER = 'product-api-security-test-pepper-2026-09-13';

const [
  { store },
  { enterpriseRouter, productApiRouter },
  { createBrowserReadSession },
  {
    assertProductApiCredentialEnvironment,
    productApiSecretForKey,
  },
  { issueLocalIdentityTokenForTest },
] = await Promise.all([
  import('../storage/index.js'),
  import('../routes/enterprise.js'),
  import('../digitalEmployees/browserReadSession.js'),
  import('../lib/productApiCredentials.js'),
  import('../auth/localIdentity.js'),
]);

const attackerTenantId = 'product-api-attacker-tenant';
const victimTenantId = 'product-api-victim-tenant';
const duplicateTenantId = 'product-api-duplicate-tenant';
const concurrentTenantId = 'product-api-concurrent-tenant';
const starterTenantId = 'product-api-starter-tenant';
const invalidAccessTenantId = 'product-api-invalid-access-tenant';
const legacyTenantId = 'product-api-legacy-tenant';
const testPepper = process.env.PRODUCT_API_KEY_PEPPER!;
const testKey = (tenantId: string, keyId: string, fill: string) => {
  assert.equal(keyId.length, 16);
  const apiKey = `ls_prod_${keyId}_${fill.repeat(43)}`;
  const digest = createHmac('sha256', testPepper)
    .update('lingshu-product-api-key\0', 'utf8')
    .update(tenantId, 'utf8')
    .update('\0', 'utf8')
    .update(keyId, 'utf8')
    .update('\0', 'utf8')
    .update(apiKey, 'utf8')
    .digest('hex');
  return { apiKey, digest, keyId, keyPrefix: `ls_prod_${keyId}`, keyLast4: fill.repeat(4) };
};
const victimCredential = testKey(victimTenantId, 'victimkid0000001', 'V');
const starterCredential = testKey(starterTenantId, 'starterkid000001', 'S');
const invalidAccessCredential = testKey(invalidAccessTenantId, 'invalidkid000001', 'I');
const victimSentinel = victimCredential.apiKey;
const duplicateSentinel = 'duplicate-product-api-sentinel-DUPE';
const records: Array<Record<string, unknown> & { id: string }> = [{
  id: 'victim-key-record',
  tenant_id: victimTenantId,
  key_id: victimCredential.keyId,
  key_prefix: victimCredential.keyPrefix,
  key_last4: victimCredential.keyLast4,
  key_hmac: victimCredential.digest,
  key_hmac_version: 'hmac-sha256-v1',
  credential_status: 'active',
  created_at: '2026-01-02T03:04:05.000Z',
  last_ingested_at: '2026-01-03T03:04:05.000Z',
  last_product_name: 'Victim confidential product',
}, {
  id: 'duplicate-key-record-1',
  tenant_id: duplicateTenantId,
  credential_status: 'requires_rotation',
  created_at: '2026-01-04T03:04:05.000Z',
}, {
  id: 'duplicate-key-record-2',
  tenant_id: duplicateTenantId,
  credential_status: 'requires_rotation',
  created_at: '2026-01-05T03:04:05.000Z',
}, {
  id: 'starter-key-record',
  tenant_id: starterTenantId,
  key_id: starterCredential.keyId,
  key_prefix: starterCredential.keyPrefix,
  key_last4: starterCredential.keyLast4,
  key_hmac: starterCredential.digest,
  key_hmac_version: 'hmac-sha256-v1',
  credential_status: 'active',
  created_at: '2026-01-06T03:04:05.000Z',
}, {
  id: 'invalid-access-key-record',
  tenant_id: invalidAccessTenantId,
  key_id: invalidAccessCredential.keyId,
  key_prefix: invalidAccessCredential.keyPrefix,
  key_last4: invalidAccessCredential.keyLast4,
  key_hmac: invalidAccessCredential.digest,
  key_hmac_version: 'hmac-sha256-v1',
  credential_status: 'active',
  created_at: '2026-01-07T03:04:05.000Z',
}, {
  id: 'legacy-key-record',
  tenant_id: legacyTenantId,
  credential_status: 'requires_rotation',
  created_at: '2026-01-08T03:04:05.000Z',
}];

const zeroLimits = {
  workspaceCount: 0, brandCount: 0, memberCount: 0, agentTeamCount: 0,
  productCount: 0, marketCount: 0, buyerPersonaCount: 0, languageCount: 0,
  primaryPlatformCount: 0, concurrentRunCount: 0, contentArtifactCountPerCycle: 0,
  contentRevisionCountPerCycle: 0, publicationPackageCountPerContent: 0,
  assistedSessionCount: 0, inquiryAiCountPerCycle: 0, quoteDraftCountPerCycle: 0,
  highCostVideoCount: 0, budgetCnyPerCycle: 0,
  agentBudgetCny: { orchestrator: 0, content: 0, traffic: 0, sales: 0 },
};
const starterAccessRecords: Array<Record<string, unknown> & { id: string }> = [{
  id: 'starter-access-record', tenant_id: starterTenantId,
  product_profile: 'starter_198', profile_version: 'starter_198.v1',
  entitlement_snapshot_id: 'starter-product-api-snapshot', feature_entitlements: [],
  resource_limits: zeroLimits, status: 'active',
  cycle_started_at: '2026-01-01T00:00:00.000Z', cycle_ends_at: '2027-01-01T00:00:00.000Z',
  updated_at: '2026-01-06T03:04:05.000Z',
}, {
  id: 'invalid-access-record', tenant_id: invalidAccessTenantId,
  product_profile: 'starter_198', profile_version: 'corrupt-version',
}];

const originalStore = {
  list: store.list,
  getById: store.getById,
  create: store.create,
  update: store.update,
  delete: store.delete,
};
let listCalls = 0;
let createCalls = 0;
let updateCalls = 0;
let deleteCalls = 0;
const leaseRecords: Array<Record<string, unknown> & { id: string }> = [];

store.list = (async (collection: string, query: { where?: Record<string, unknown>; page?: number; perPage?: number } = {}) => {
  listCalls += 1;
  const source = collection === 'tenant_api_keys'
    ? records
    : collection === 'durable_operation_leases'
      ? leaseRecords
    : collection === 'starter_198_access'
      ? starterAccessRecords
      : [];
  const items = source.filter(record => Object.entries(query.where ?? {}).every(([key, value]) => record[key] === value));
  return {
    items,
    totalItems: items.length,
    totalPages: items.length ? 1 : 0,
    page: query.page ?? 1,
    perPage: query.perPage ?? 20,
  };
}) as typeof store.list;
store.getById = (async (collection: string, id: string) => {
  if (collection === 'durable_operation_leases') return leaseRecords.find(record => record.id === id) ?? null;
  return null;
}) as typeof store.getById;
store.create = (async (collection: string, data: Record<string, unknown>) => {
  if (collection === 'durable_operation_leases') {
    const lease = { id: `lease-record-${leaseRecords.length + 1}`, ...data };
    leaseRecords.push(lease);
    return lease;
  }
  if (collection !== 'tenant_api_keys') return null;
  createCalls += 1;
  if (data.tenant_id === concurrentTenantId) await new Promise(resolve => setTimeout(resolve, 20));
  const record = { id: `key-record-${records.length + 1}`, ...data };
  records.push(record);
  return record;
}) as typeof store.create;
store.update = (async (collection: string, id: string, data: Record<string, unknown>) => {
  if (collection === 'durable_operation_leases') {
    const index = leaseRecords.findIndex(record => record.id === id);
    if (index < 0) return false;
    leaseRecords[index] = { ...leaseRecords[index], ...data };
    return true;
  }
  if (collection !== 'tenant_api_keys') return false;
  updateCalls += 1;
  const index = records.findIndex(record => record.id === id);
  if (index < 0) return false;
  records[index] = { ...records[index], ...data };
  return true;
}) as typeof store.update;
store.delete = (async (collection: string, id: string) => {
  if (collection === 'durable_operation_leases') {
    const index = leaseRecords.findIndex(record => record.id === id);
    if (index < 0) return false;
    leaseRecords.splice(index, 1);
    return true;
  }
  if (collection !== 'tenant_api_keys') return false;
  deleteCalls += 1;
  return false;
}) as typeof store.delete;

const app = express();
app.use(express.json());
app.use('/api/overseas/enterprise', enterpriseRouter);
app.use('/api/v1/products', productApiRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('test server did not bind a TCP port');
const origin = `http://127.0.0.1:${address.port}/api/overseas/enterprise`;
const productOrigin = `http://127.0.0.1:${address.port}/api/v1/products`;

function localToken(tenantId: string, role?: 'super_admin' | 'admin' | 'social_operator' | 'customer_service'): string {
  return issueLocalIdentityTokenForTest({
    userId: `${tenantId}-${role || 'missing'}-user`,
    tenantId,
    email: `${tenantId}@example.test`,
    ...(role ? { role } : {}),
  });
}

async function request(
  pathname: string,
  token: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown>; raw: string; headers: Headers }> {
  const response = await fetch(`${origin}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
  const raw = await response.text();
  return {
    status: response.status,
    body: raw ? JSON.parse(raw) as Record<string, unknown> : {},
    raw,
    headers: response.headers,
  };
}

async function productRequest(pathname: string, apiKey: string, init: RequestInit = {}) {
  const response = await fetch(`${productOrigin}${pathname}`, {
    ...init,
    headers: { 'x-api-key': apiKey, ...init.headers },
  });
  const raw = await response.text();
  return { status: response.status, body: raw ? JSON.parse(raw) as Record<string, unknown> : {}, raw };
}

const attackerAdminToken = localToken(attackerTenantId, 'admin');
const victimOwnerToken = localToken(victimTenantId, 'super_admin');
const browserSession = createBrowserReadSession({
  tenantId: attackerTenantId,
  userId: `${attackerTenantId}-browser-agent`,
  role: 'admin',
  dataAuthority: 'local',
});
const enterpriseSource = fs.readFileSync(path.join(originalCwd, 'server/routes/enterprise.ts'), 'utf8');
const credentialSource = fs.readFileSync(path.join(originalCwd, 'server/lib/productApiCredentials.ts'), 'utf8');
assert.doesNotMatch(
  enterpriseSource,
  /PRODUCT_API_FILE|writeProductApiSecret|migrateLegacyProductApiSecret/,
  'ordinary enterprise reads must not contain the retired implicit credential-file migration',
);
assert.doesNotMatch(
  credentialSource,
  /\bapi_key\b/,
  'runtime Product API credential code must never persist or query the retired plaintext field',
);
assert.match(credentialSource, /createHmac\('sha256'/, 'Product API keys must use HMAC-SHA256 rather than a bare fast hash');
assert.match(credentialSource, /timingSafeEqual/, 'Product API authentication must compare digests in constant time');
assert.throws(
  () => assertProductApiCredentialEnvironment({ NODE_ENV: 'production' }),
  /PRODUCT_API_KEY_PEPPER is required/,
  'production startup must reject a missing Product API pepper',
);
assert.throws(
  () => assertProductApiCredentialEnvironment({ NODE_ENV: 'production', PRODUCT_API_KEY_PEPPER: 'too-short' }),
  /at least 32 bytes/,
  'production startup must reject an undersized Product API pepper',
);
assert.throws(
  () => assertProductApiCredentialEnvironment({
    NODE_ENV: 'production',
    PRODUCT_API_KEY_PEPPER: 'generate-independently-with-openssl-rand-base64-48',
  }),
  /must not use an example placeholder/,
  'production startup must reject an unchanged example placeholder',
);
assert.doesNotThrow(() => assertProductApiCredentialEnvironment({
  NODE_ENV: 'test',
  PRODUCT_API_KEY_PEPPER: testPepper,
}));
const originalWriteFileSync = fs.writeFileSync;
let synchronousFileWrites = 0;
fs.writeFileSync = (() => {
  synchronousFileWrites += 1;
  throw new Error('unexpected synchronous write during read-only route test');
}) as typeof fs.writeFileSync;

try {
  const profileRead = await request('/profile', attackerAdminToken);
  assert.equal(profileRead.status, 200, 'the real DEMO_MODE profile read must remain available');
  assert.equal(synchronousFileWrites, 0, 'GET /profile must not write a legacy credential file');

  const writesBeforeStarterChecks = createCalls + updateCalls + deleteCalls;
  const starterManagerRead = await request('/product-api', localToken(starterTenantId, 'admin'));
  assert.equal(starterManagerRead.status, 403, 'starter tenants must not read legacy API-key metadata');
  assert.equal(starterManagerRead.body.error, 'starter_198_orchestrator_only');
  const starterManagerCreate = await request('/product-api', localToken(starterTenantId, 'admin'), { method: 'POST' });
  assert.equal(starterManagerCreate.status, 403, 'starter tenants must not create a legacy product API key');
  const starterExternalRead = await productRequest('/', starterCredential.apiKey);
  assert.equal(starterExternalRead.status, 401, 'a historical key must not remain a starter read bypass or prove that it is valid');
  assert.equal(starterExternalRead.body.error, 'Invalid API Key');
  const starterExternalWrite = await productRequest('/bulk', starterCredential.apiKey, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{ sku: 'blocked', name: 'blocked' }]),
  });
  assert.equal(starterExternalWrite.status, 401, 'a historical key must not remain a starter write bypass');
  const starterExternalDelete = await productRequest('/blocked', starterCredential.apiKey, { method: 'DELETE' });
  assert.equal(starterExternalDelete.status, 401, 'a historical key must not delete starter product data');
  assert.equal(createCalls + updateCalls + deleteCalls, writesBeforeStarterChecks, 'starter boundary checks must not mutate credentials');

  const invalidAccessManager = await request('/product-api', localToken(invalidAccessTenantId, 'admin'));
  assert.equal(invalidAccessManager.status, 503, 'an invalid starter authority row must fail closed');
  assert.equal(invalidAccessManager.body.error, 'starter_198_access_unavailable');
  const invalidAccessExternal = await productRequest('/', invalidAccessCredential.apiKey);
  assert.equal(invalidAccessExternal.status, 503, 'the external API must fail closed when starter authority is invalid');
  assert.doesNotMatch(invalidAccessExternal.raw, new RegExp(invalidAccessCredential.apiKey));

  const writesBeforeReads = createCalls + updateCalls + deleteCalls;
  const browserRead = await request(
    `/product-api?tenantId=${encodeURIComponent(victimTenantId)}`,
    browserSession.token,
    { headers: { 'x-tenant-id': victimTenantId } },
  );
  assert.equal(browserRead.status, 403, 'browser-read sessions must never access API-key management GETs');
  assert.equal(browserRead.body.error, 'agent_browser_read_only');
  assert.doesNotMatch(browserRead.raw, new RegExp(victimSentinel));

  const browserWrite = await request('/product-api', browserSession.token, { method: 'POST' });
  assert.equal(browserWrite.status, 403, 'browser-read sessions must never create API keys');
  assert.equal(browserWrite.body.error, 'agent_browser_read_only');

  const missingRole = await request('/product-api', localToken(attackerTenantId));
  assert.equal(missingRole.status, 403, 'a missing role must fail closed instead of gaining key-manager access');
  assert.equal(missingRole.body.error, 'product_api_manager_required');

  const operatorRead = await request('/product-api', localToken(attackerTenantId, 'social_operator'));
  assert.equal(operatorRead.status, 403, 'ordinary operators must not read API-key metadata');
  assert.equal(operatorRead.body.error, 'product_api_manager_required');

  const duplicateToken = localToken(duplicateTenantId, 'super_admin');
  const writesBeforeDuplicateChecks = createCalls + updateCalls + deleteCalls;
  const duplicateRead = await request('/product-api', duplicateToken);
  assert.equal(duplicateRead.status, 503, 'duplicate tenant credentials must make metadata reads fail closed');
  assert.doesNotMatch(duplicateRead.raw, new RegExp(duplicateSentinel));
  const duplicateCredentialCreate = await request('/product-api', duplicateToken, { method: 'POST' });
  assert.equal(duplicateCredentialCreate.status, 503, 'create must not hide or overwrite duplicate historical credentials');
  const duplicateRotate = await request('/product-api/rotate', duplicateToken, { method: 'POST' });
  assert.equal(duplicateRotate.status, 503, 'rotation must not leave one of several historical keys active');
  assert.equal(await productApiSecretForKey(duplicateSentinel), null, 'external API authentication must reject ambiguous duplicate keys');
  assert.equal(
    createCalls + updateCalls + deleteCalls,
    writesBeforeDuplicateChecks,
    'duplicate detection must not automatically delete, merge, or overwrite credentials',
  );

  const attackerRead = await request(
    `/product-api?tenantId=${encodeURIComponent(victimTenantId)}`,
    attackerAdminToken,
    { headers: { 'x-tenant-id': victimTenantId } },
  );
  assert.equal(attackerRead.status, 200);
  assert.equal(attackerRead.body.tenantId, attackerTenantId, 'query/header tenant overrides must be ignored');
  assert.equal(attackerRead.body.apiKeySet, false, 'GET must not synthesize a key for an unconfigured tenant');
  assert.equal('apiKey' in attackerRead.body, false, 'GET must never return a plaintext API key');
  assert.match(attackerRead.headers.get('cache-control') ?? '', /no-store/);
  assert.doesNotMatch(attackerRead.raw, new RegExp(victimSentinel));

  const victimRead = await request('/product-api', victimOwnerToken);
  assert.equal(victimRead.status, 200);
  assert.equal(victimRead.body.tenantId, victimTenantId);
  assert.equal(victimRead.body.apiKeySet, true);
  assert.equal(victimRead.body.apiKeyLast4, victimCredential.keyLast4);
  assert.equal(victimRead.body.keyPrefix, victimCredential.keyPrefix);
  assert.equal(victimRead.body.requiresRotation, false);
  assert.equal('apiKey' in victimRead.body, false, 'configured GETs must expose only non-sensitive metadata');
  assert.doesNotMatch(victimRead.raw, new RegExp(victimSentinel));
  assert.equal(
    createCalls + updateCalls + deleteCalls,
    writesBeforeReads,
    'all API-key GET paths must remain zero-write',
  );

  const created = await request(
    `/product-api?tenantId=${encodeURIComponent(victimTenantId)}`,
    attackerAdminToken,
    { method: 'POST', headers: { 'x-tenant-id': victimTenantId } },
  );
  assert.equal(created.status, 201);
  assert.equal(created.body.tenantId, attackerTenantId, 'create must bind to the authenticated tenant');
  assert.equal(typeof created.body.apiKey, 'string');
  assert.match(String(created.body.apiKey), /^ls_prod_[A-Za-z0-9_-]{16}_[A-Za-z0-9_-]{43}$/);
  assert.doesNotMatch(created.raw, new RegExp(victimSentinel));
  assert.equal(createCalls, 1);
  assert.equal(records.filter(record => record.tenant_id === victimTenantId).length, 1, 'victim records must not be created or duplicated');
  const createdKey = String(created.body.apiKey);
  const attackerCredentialRecord = records.find(record => record.tenant_id === attackerTenantId);
  assert.ok(attackerCredentialRecord, 'create must persist one tenant credential record');
  assert.equal(Object.hasOwn(attackerCredentialRecord, 'api_key'), false, 'new credentials must never persist the bearer key field');
  assert.equal(attackerCredentialRecord.credential_status, 'active');
  assert.match(String(attackerCredentialRecord.key_hmac), /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(attackerCredentialRecord), new RegExp(createdKey));

  const createdAuthentication = await productRequest('/', createdKey);
  assert.equal(createdAuthentication.status, 200, 'the one-time plaintext response must authenticate against its stored HMAC');
  const alteredCreatedKey = `${createdKey.slice(0, -1)}${createdKey.endsWith('A') ? 'B' : 'A'}`;
  assert.equal((await productRequest('/', alteredCreatedKey)).status, 401, 'a one-byte key alteration must fail authentication');

  const hiddenAfterCreate = await request('/product-api', attackerAdminToken);
  assert.equal(hiddenAfterCreate.status, 200);
  assert.equal(hiddenAfterCreate.body.apiKeySet, true);
  assert.equal(hiddenAfterCreate.body.apiKeyLast4, createdKey.slice(-4));
  assert.equal('apiKey' in hiddenAfterCreate.body, false, 'a newly created key must not be replayed by a later GET');
  assert.doesNotMatch(hiddenAfterCreate.raw, new RegExp(createdKey));

  const duplicateCreate = await request('/product-api', attackerAdminToken, { method: 'POST' });
  assert.equal(duplicateCreate.status, 409, 'create must not overwrite an existing key');
  assert.equal('apiKey' in duplicateCreate.body, false, 'create conflicts must not echo an existing key');
  assert.doesNotMatch(duplicateCreate.raw, new RegExp(createdKey));
  assert.equal(createCalls, 1);

  const rotated = await request(
    `/product-api/rotate?tenantId=${encodeURIComponent(victimTenantId)}`,
    attackerAdminToken,
    { method: 'POST', headers: { 'x-tenant-id': victimTenantId } },
  );
  assert.equal(rotated.status, 200);
  assert.equal(rotated.body.tenantId, attackerTenantId, 'rotation must bind to the authenticated tenant');
  assert.match(String(rotated.body.apiKey), /^ls_prod_[A-Za-z0-9_-]{16}_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(rotated.body.apiKey, createdKey);
  assert.equal(updateCalls, 1);
  assert.equal(
    records.find(record => record.id === 'victim-key-record')?.key_hmac,
    victimCredential.digest,
    'victim key digest must not be rotated by another tenant',
  );
  assert.doesNotMatch(rotated.raw, new RegExp(victimSentinel));
  const rotatedKey = String(rotated.body.apiKey);
  assert.equal((await productRequest('/', createdKey)).status, 401, 'rotation must revoke replay of the previously issued key');
  assert.equal((await productRequest('/', rotatedKey)).status, 200, 'the newly rotated key must authenticate');

  const hiddenAfterRotate = await request('/product-api', attackerAdminToken);
  assert.equal(hiddenAfterRotate.status, 200);
  assert.equal(hiddenAfterRotate.body.apiKeyLast4, rotatedKey.slice(-4));
  assert.equal('apiKey' in hiddenAfterRotate.body, false, 'a rotated key must be returned only by the rotation response');
  assert.doesNotMatch(hiddenAfterRotate.raw, new RegExp(rotatedKey));

  const victimRecord = records.find(record => record.id === 'victim-key-record');
  assert.ok(victimRecord);
  const originalVictimDigest = victimRecord.key_hmac;
  victimRecord.key_hmac = `${String(originalVictimDigest).slice(0, -1)}${String(originalVictimDigest).endsWith('0') ? '1' : '0'}`;
  assert.equal(await productApiSecretForKey(victimCredential.apiKey), null, 'a tampered stored HMAC must fail closed');
  victimRecord.key_hmac = originalVictimDigest;
  victimRecord.tenant_id = attackerTenantId;
  assert.equal(
    await productApiSecretForKey(victimCredential.apiKey),
    null,
    'the HMAC must bind the key to its tenant so a record cannot be reassigned across tenants',
  );
  victimRecord.tenant_id = victimTenantId;
  assert.equal((await productRequest('/', victimCredential.apiKey)).status, 200, 'restoring untampered metadata must restore authentication');

  const listCallsBeforeMalformedKey = listCalls;
  assert.equal(await productApiSecretForKey("ls_prod_' || tenant_id != ''"), null);
  assert.equal(listCalls, listCallsBeforeMalformedKey, 'malformed key ids must be rejected before any database query');

  const legacyToken = localToken(legacyTenantId, 'admin');
  const legacyMetadata = await request('/product-api', legacyToken);
  assert.equal(legacyMetadata.status, 200);
  assert.equal(legacyMetadata.body.apiKeySet, true, 'a legacy record must remain visible so its manager can rotate it');
  assert.equal(legacyMetadata.body.apiKeyActive, false, 'a legacy plaintext record must never be considered active');
  assert.equal(legacyMetadata.body.requiresRotation, true, 'a legacy record must explicitly require manager rotation');
  assert.equal(legacyMetadata.body.apiKeyLast4, '', 'legacy plaintext must not be used to reconstruct display metadata');
  assert.equal(
    (await productRequest('/', 'legacy-plaintext-key-must-never-authenticate')).status,
    401,
    'an old plaintext record must fail closed instead of being transparently migrated',
  );
  const legacyRotated = await request('/product-api/rotate', legacyToken, { method: 'POST' });
  assert.equal(legacyRotated.status, 200);
  const legacyRotatedKey = String(legacyRotated.body.apiKey);
  assert.match(legacyRotatedKey, /^ls_prod_[A-Za-z0-9_-]{16}_[A-Za-z0-9_-]{43}$/);
  const legacyRecord = records.find(record => record.id === 'legacy-key-record');
  assert.equal(legacyRecord?.credential_status, 'active');
  assert.doesNotMatch(JSON.stringify(legacyRecord), new RegExp(legacyRotatedKey));
  assert.equal((await productRequest('/', legacyRotatedKey)).status, 200, 'explicit rotation must issue a usable hashed credential');

  assert.equal(deleteCalls, 0);
  assert.ok(listCalls > 0, 'the test must exercise the real route read path');

  const createCallsBeforeConcurrency = createCalls;
  const concurrentToken = localToken(concurrentTenantId, 'admin');
  const concurrentCreates = await Promise.all([
    request('/product-api', concurrentToken, { method: 'POST' }),
    request('/product-api', concurrentToken, { method: 'POST' }),
  ]);
  assert.deepEqual(
    concurrentCreates.map(result => result.status).sort((a, b) => a - b),
    [201, 409],
    'same-process concurrent creation must yield exactly one new credential',
  );
  assert.equal(createCalls, createCallsBeforeConcurrency + 1, 'the tenant mutation queue must serialize the check-and-create sequence');
  assert.equal(records.filter(record => record.tenant_id === concurrentTenantId).length, 1);

  console.log('enterprise product API security route tests passed');
} finally {
  fs.writeFileSync = originalWriteFileSync;
  browserSession.revoke();
  Object.assign(store, originalStore);
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  process.chdir(originalCwd);
  fs.rmSync(temporaryCwd, { recursive: true, force: true });
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
