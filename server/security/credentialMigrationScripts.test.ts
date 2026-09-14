import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {
  assertOrganizationRoleMigrationGate,
  assertPasswordResetMigrationGate,
  buildPasswordResetRequiredManifest,
  consumeMigrationApplyIntent,
  migratedSupportDefaultAuthorized,
  organizationRoleMigrationIssues,
  parseLocalTenantMigrationSource,
} from '../../scripts/migrate-production-data.js';
import {
  assertDemoBootstrapActivationAllowed,
  isPocketBaseNotFound,
  legacyCredentialEmails,
  parseOneTimeBootstrapAccounts,
  PocketBaseRequestError,
  sanitizeDemoRegistryRecord,
} from '../../scripts/sync-demo-accounts.js';
import {
  applyDemoAccountCredentialMigration,
  mergeDemoAccountRegistryMetadata,
  readDemoAccountCredentialMigrationPlan,
  readDemoAccountRegistrySnapshot,
} from '../lib/demoAccounts.js';
import { withoutLegacyRegistrationCredentialField } from '../../scripts/setup-pb.js';
import { withoutRecoverableTenantCredentialField } from '../storage/ensureDeliveryCollections.js';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

const explicitApplyEnvironment: NodeJS.ProcessEnv = { MIGRATION_APPLY: ' TrUe ' };
assert.equal(consumeMigrationApplyIntent(explicitApplyEnvironment), true);
assert.equal(Object.hasOwn(explicitApplyEnvironment, 'MIGRATION_APPLY'), false, 'one-shot apply intent must be consumed');
const defaultDryRunEnvironment: NodeJS.ProcessEnv = {};
assert.equal(consumeMigrationApplyIntent(defaultDryRunEnvironment), false);
const falseApplyEnvironment: NodeJS.ProcessEnv = { MIGRATION_APPLY: 'false' };
assert.equal(consumeMigrationApplyIntent(falseApplyEnvironment), false);
assert.equal(Object.hasOwn(falseApplyEnvironment, 'MIGRATION_APPLY'), false);

const resetAccount = {
  email: 'reset-required@example.test',
  oldTenantId: 'legacy-tenant',
  companyName: 'Reset Required Co.',
  reason: 'missing_auth_user' as const,
  requiredAction: 'provision_auth_user_via_one_time_reset' as const,
};
const blockedManifest = buildPasswordResetRequiredManifest([resetAccount], {
  applyRequested: true,
  generatedAt: '2026-09-12T00:00:00.000Z',
});
assert.equal(blockedManifest.unresolvedCount, 1);
assert.throws(
  () => assertPasswordResetMigrationGate(blockedManifest),
  /controlled reset workflow/,
  'apply must stop before writes while any reset-required user remains unresolved',
);
assert.doesNotThrow(() => assertPasswordResetMigrationGate({ ...blockedManifest, applyRequested: false }));
assert.doesNotThrow(() => assertPasswordResetMigrationGate({ ...blockedManifest, unresolvedCount: 0, accounts: [], releaseBlocked: false }));
const invalidRoleUsers = organizationRoleMigrationIssues([
  { id: 'valid-owner', email: 'owner@example.test', tenantId: 'tenant-1', role: 'super_admin' },
  { id: 'missing-role', email: 'missing@example.test', tenantId: 'tenant-1' },
  { id: 'invalid-role', email: 'invalid@example.test', tenantId: 'tenant-1', role: 'owner' },
]);
assert.deepEqual(invalidRoleUsers.map(issue => issue.userId), ['missing-role', 'invalid-role']);
assert.throws(
  () => assertOrganizationRoleMigrationGate(invalidRoleUsers),
  /explicit least-privilege role/,
  'apply must stop before writes while any user role is missing or invalid',
);
assert.doesNotThrow(() => assertOrganizationRoleMigrationGate([]));
assert.equal(migratedSupportDefaultAuthorized(undefined), false);
assert.equal(migratedSupportDefaultAuthorized(false), false);
assert.equal(migratedSupportDefaultAuthorized(true), true);
assert.throws(() => parseLocalTenantMigrationSource('not-json'), /valid JSON/);
assert.throws(() => parseLocalTenantMigrationSource('{}'), /must contain an array/);
assert.throws(() => parseLocalTenantMigrationSource('[{}]'), /must contain a tenant id/);
assert.deepEqual(
  parseLocalTenantMigrationSource('[{"id":"tenant-1","registeredEmail":"owner@example.test","registeredPasswordCipher":"legacy-cipher"}]'),
  [{ id: 'tenant-1', registeredEmail: 'owner@example.test' }],
  'tenant source parsing must drop historical ciphertext before any migration payload is built',
);
assert.doesNotMatch(
  JSON.stringify(blockedManifest),
  /registeredPasswordCipher|rotationPassword|"password"/,
  'reset manifest must contain identity and reset state only',
);

assert.throws(() => parseOneTimeBootstrapAccounts(undefined), /DEMO_ACCOUNT_BOOTSTRAP_JSON is required/);
assert.throws(() => parseOneTimeBootstrapAccounts('[]'), /non-empty array/);
assert.throws(
  () => parseOneTimeBootstrapAccounts(JSON.stringify([{ email: 'demo@example.test', password: 'too-short' }])),
  /at least 12 characters/,
);
assert.throws(
  () => parseOneTimeBootstrapAccounts(JSON.stringify([{ email: 'demo@example.test', password: 'OneTimeSecret!1', role: 'owner' }])),
  /invalid role/,
);
assert.throws(
  () => parseOneTimeBootstrapAccounts(JSON.stringify([
    { email: 'demo@example.test', password: 'OneTimeSecret!1' },
    { email: 'DEMO@example.test', password: 'OneTimeSecret!2' },
  ])),
  /duplicate bootstrap account/,
);
const bootstrap = parseOneTimeBootstrapAccounts(JSON.stringify([
  {
    email: ' Demo@Example.Test ',
    password: 'OneTimeSecret!1',
    status: 'trialing',
    role: 'admin',
  },
]));
assert.deepEqual(bootstrap, [{
  email: 'demo@example.test',
  password: 'OneTimeSecret!1',
  name: undefined,
  role: 'admin',
  tenantId: undefined,
  activatedAt: undefined,
  expiresAt: undefined,
  status: 'trialing',
}]);
assert.throws(
  () => assertDemoBootstrapActivationAllowed({ email: 'expired@example.test', status: 'expired', role: 'admin' }),
  /explicit non-expired status/,
  'one-time bootstrap must not silently reactivate an expired trial account',
);
assert.throws(
  () => assertDemoBootstrapActivationAllowed({ email: 'ambiguous@example.test', role: 'admin' }),
  /explicit valid account status/,
);
assert.throws(
  () => assertDemoBootstrapActivationAllowed({ email: 'ambiguous@example.test', status: 'customer' }),
  /explicit valid account role/,
);
assert.doesNotThrow(() => assertDemoBootstrapActivationAllowed({
  email: 'active@example.test',
  status: 'customer',
  role: 'admin',
}));
assert.equal(isPocketBaseNotFound(new PocketBaseRequestError(404, 'PATCH', '/tenants/id', 'missing')), true);
assert.equal(isPocketBaseNotFound(new PocketBaseRequestError(500, 'PATCH', '/tenants/id', 'unavailable')), false);
assert.equal(isPocketBaseNotFound(new Error('network failure')), false);

const scrubbedRegistryEntry = sanitizeDemoRegistryRecord({
  email: 'legacy-demo@example.test',
  password: 'LegacySecret!1',
  rotationPassword: 'LegacySecret!2',
  registeredPasswordCipher: 'v1:legacy-cipher',
  status: 'trialing',
  userId: 'demo-user',
});
assert.equal(Object.hasOwn(scrubbedRegistryEntry, 'password'), false);
assert.equal(Object.hasOwn(scrubbedRegistryEntry, 'rotationPassword'), false);
assert.equal(Object.hasOwn(scrubbedRegistryEntry, 'registeredPasswordCipher'), false);
assert.equal(scrubbedRegistryEntry.credentialState, 'password_reset_required');
assert.deepEqual(
  legacyCredentialEmails({
    'safe@example.test': { email: 'safe@example.test', credentialState: 'active_hash_only' },
    'legacy@example.test': { email: 'Legacy@Example.Test', password: 'LegacySecret!1' },
  }),
  ['legacy@example.test'],
  'explicit bootstrap must be able to block when any legacy credential account is not covered',
);

const registryTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-registry-migration-'));
const registryPrimary = path.join(registryTempDir, 'demo-account-registry.json');
const registryBackup = path.join(registryTempDir, 'demo-account-registry.backup.json');
const legacyRegistry = {
  'legacy@example.test': {
    email: 'legacy@example.test',
    userId: 'legacy-user',
    tenantId: 'legacy-tenant',
    status: 'trialing',
    password: 'LegacySecret!1',
    rotationPassword: 'LegacySecret!2',
    registeredPasswordCipher: 'v1:LegacyCipher',
  },
};
const legacyRegistryBytes = JSON.stringify(legacyRegistry, null, 2);
fs.writeFileSync(registryPrimary, legacyRegistryBytes, { mode: 0o600 });
fs.writeFileSync(registryBackup, legacyRegistryBytes, { mode: 0o600 });
const primaryMtimeBeforeRead = fs.statSync(registryPrimary, { bigint: true }).mtimeNs;
const backupMtimeBeforeRead = fs.statSync(registryBackup, { bigint: true }).mtimeNs;

try {
  const runtimeView = readDemoAccountRegistrySnapshot({
    primaryFile: registryPrimary,
    backupFile: registryBackup,
  });
  assert.equal(Object.hasOwn(runtimeView['legacy@example.test'], 'password'), false);
  assert.equal(Object.hasOwn(runtimeView['legacy@example.test'], 'rotationPassword'), false);
  assert.equal(Object.hasOwn(runtimeView['legacy@example.test'], 'registeredPasswordCipher'), false);
  assert.equal(runtimeView['legacy@example.test'].credentialState, 'password_reset_required');
  assert.equal(fs.readFileSync(registryPrimary, 'utf8'), legacyRegistryBytes, 'normal reads must not rewrite the primary registry');
  assert.equal(fs.readFileSync(registryBackup, 'utf8'), legacyRegistryBytes, 'normal reads must not rewrite the backup registry');
  assert.equal(fs.statSync(registryPrimary, { bigint: true }).mtimeNs, primaryMtimeBeforeRead, 'normal reads must preserve primary mtime');
  assert.equal(fs.statSync(registryBackup, { bigint: true }).mtimeNs, backupMtimeBeforeRead, 'normal reads must preserve backup mtime');

  const metadataOnlyUpdate = mergeDemoAccountRegistryMetadata(legacyRegistry, {
    'legacy@example.test': { email: 'legacy@example.test', guidePending: false },
  });
  assert.equal(metadataOnlyUpdate['legacy@example.test'].password, 'LegacySecret!1', 'routine metadata updates must not implicitly scrub legacy credentials');
  assert.equal(metadataOnlyUpdate['legacy@example.test'].registeredPasswordCipher, 'v1:LegacyCipher');

  const plan = readDemoAccountCredentialMigrationPlan({
    primaryFile: registryPrimary,
    backupFile: registryBackup,
    generatedAt: '2026-09-12T00:00:00.000Z',
  });
  assert.equal(plan.resetRequiredCount, 1);
  assert.equal(plan.releaseBlocked, true);
  assert.deepEqual(plan.accounts[0].legacyFields, ['password', 'rotationPassword', 'registeredPasswordCipher']);
  assert.doesNotMatch(JSON.stringify(plan), /LegacySecret|LegacyCipher/, 'reset plan must never expose credential values');
  assert.throws(() => applyDemoAccountCredentialMigration({
    expectedSourceFingerprint: 'stale-fingerprint',
    confirmedResetEmails: ['legacy@example.test'],
    primaryFile: registryPrimary,
    backupFile: registryBackup,
  }), /source changed/);
  assert.throws(() => applyDemoAccountCredentialMigration({
    expectedSourceFingerprint: plan.sourceFingerprint,
    confirmedResetEmails: [],
    primaryFile: registryPrimary,
    backupFile: registryBackup,
  }), /requires confirmed resets/);
  assert.equal(fs.readFileSync(registryPrimary, 'utf8'), legacyRegistryBytes, 'failed explicit apply must not alter primary');
  assert.equal(fs.readFileSync(registryBackup, 'utf8'), legacyRegistryBytes, 'failed explicit apply must not alter backup');

  applyDemoAccountCredentialMigration({
    expectedSourceFingerprint: plan.sourceFingerprint,
    confirmedResetEmails: ['legacy@example.test'],
    primaryFile: registryPrimary,
    backupFile: registryBackup,
  });
  for (const file of [registryPrimary, registryBackup]) {
    const contents = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(contents, /LegacySecret|LegacyCipher/);
    const parsed = JSON.parse(contents) as Record<string, Record<string, unknown>>;
    assert.equal(Object.hasOwn(parsed['legacy@example.test'], 'password'), false);
    assert.equal(Object.hasOwn(parsed['legacy@example.test'], 'rotationPassword'), false);
    assert.equal(Object.hasOwn(parsed['legacy@example.test'], 'registeredPasswordCipher'), false);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }

  const cleanPlan = readDemoAccountCredentialMigrationPlan({ primaryFile: registryPrimary, backupFile: registryBackup });
  const primaryMtimeBeforeSecondApply = fs.statSync(registryPrimary, { bigint: true }).mtimeNs;
  applyDemoAccountCredentialMigration({
    expectedSourceFingerprint: cleanPlan.sourceFingerprint,
    confirmedResetEmails: [],
    primaryFile: registryPrimary,
    backupFile: registryBackup,
  });
  assert.equal(fs.statSync(registryPrimary, { bigint: true }).mtimeNs, primaryMtimeBeforeSecondApply, 'explicit migration must be idempotent');
  assert.equal(fs.readdirSync(registryTempDir).some(file => file.endsWith('.tmp')), false, 'explicit migration must leave no temp files');
} finally {
  fs.rmSync(registryTempDir, { recursive: true, force: true });
}

async function runMigrationProcess(environment: NodeJS.ProcessEnv): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  const child = spawn(process.execPath, [
    path.join(root, 'node_modules/tsx/dist/cli.mjs'),
    'scripts/migrate-production-data.ts',
  ], {
    cwd: root,
    env: { ...process.env, ...environment },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  return { code, stdout, stderr };
}

const migrationTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-production-dry-run-'));
const migrationTenantFile = path.join(migrationTempDir, 'local-auth-tenants.json');
const migrationManifestFile = path.join(migrationTempDir, 'reset-required.json');
const migrationSourceBytes = JSON.stringify([{
  id: 'legacy-tenant',
  companyName: 'Legacy Co.',
  registeredEmail: 'owner@example.test',
  registeredAt: '2026-09-01T00:00:00.000Z',
  subscriptionPlan: 'customer',
  registeredPasswordCipher: 'v1:do-not-touch-in-dry-run',
}], null, 2);
fs.writeFileSync(migrationTenantFile, migrationSourceBytes, { mode: 0o600 });
const migrationSourceMtime = fs.statSync(migrationTenantFile, { bigint: true }).mtimeNs;
let exposeExistingUser = true;
const remoteRecordMutations: Array<{ method: string; pathname: string }> = [];
const fakePocketBase = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
  const method = String(request.method || 'GET').toUpperCase();
  response.setHeader('Content-Type', 'application/json');
  if (requestUrl.pathname.endsWith('/auth-with-password')) {
    response.end(JSON.stringify({ token: 'migration-admin-token' }));
    return;
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && requestUrl.pathname.includes('/records')) {
    remoteRecordMutations.push({ method, pathname: requestUrl.pathname });
  }
  if (method === 'GET' && requestUrl.pathname === '/api/collections/users/records') {
    const user = { id: 'owner-user', email: 'owner@example.test', tenantId: 'legacy-tenant', role: 'super_admin' };
    response.end(JSON.stringify({
      items: exposeExistingUser ? [user] : [],
      totalPages: 1,
    }));
    return;
  }
  response.end(JSON.stringify({ items: [], totalPages: 1 }));
});

try {
  await new Promise<void>(resolve => fakePocketBase.listen(0, '127.0.0.1', resolve));
  const address = fakePocketBase.address();
  if (!address || typeof address === 'string') throw new Error('fake PocketBase did not bind');
  const commonEnvironment = {
    NODE_ENV: 'test',
    PB_URL: `http://127.0.0.1:${address.port}`,
    PB_ADMIN_EMAIL: 'migration-admin@example.test',
    PB_ADMIN_PASSWORD: 'migration-admin-secret',
    MIGRATION_DATA_DIR: migrationTempDir,
    MIGRATION_PASSWORD_RESET_MANIFEST: migrationManifestFile,
  };

  const dryRun = await runMigrationProcess({ ...commonEnvironment, MIGRATION_APPLY: 'false' });
  assert.equal(dryRun.code, 0, dryRun.stderr || dryRun.stdout);
  assert.match(dryRun.stdout, /DRY RUN/);
  assert.match(dryRun.stdout, /migration preflight/);
  assert.equal(fs.readFileSync(migrationTenantFile, 'utf8'), migrationSourceBytes, 'dry-run must preserve source bytes');
  assert.equal(fs.statSync(migrationTenantFile, { bigint: true }).mtimeNs, migrationSourceMtime, 'dry-run must preserve source mtime');
  assert.equal(fs.existsSync(migrationManifestFile), false, 'dry-run must not create a reset manifest');
  assert.equal(fs.existsSync(path.join(migrationTempDir, 'migration-tenant-id-map.json')), false, 'dry-run must not create a mapping file');
  assert.deepEqual(fs.readdirSync(migrationTempDir), ['local-auth-tenants.json'], 'dry-run must not create any file or temp file');
  assert.deepEqual(remoteRecordMutations, [], 'dry-run must not mutate remote records');

  exposeExistingUser = false;
  remoteRecordMutations.length = 0;
  const blockedApply = await runMigrationProcess({ ...commonEnvironment, MIGRATION_APPLY: 'true' });
  assert.notEqual(blockedApply.code, 0, 'apply with an unresolved reset requirement must fail');
  assert.match(`${blockedApply.stdout}\n${blockedApply.stderr}`, /controlled reset workflow/);
  assert.equal(fs.readFileSync(migrationTenantFile, 'utf8'), migrationSourceBytes, 'blocked apply must preserve source bytes');
  assert.equal(fs.existsSync(migrationManifestFile), false, 'blocked apply must not persist a manifest before validation completes');
  assert.deepEqual(remoteRecordMutations, [], 'blocked apply must not mutate remote records');
} finally {
  fakePocketBase.closeAllConnections();
  await new Promise<void>(resolve => fakePocketBase.close(() => resolve()));
  fs.rmSync(migrationTempDir, { recursive: true, force: true });
}

assert.deepEqual(
  withoutLegacyRegistrationCredentialField([
    { name: 'name', type: 'text' },
    { name: 'registeredPasswordCipher', type: 'text' },
    { name: 'registeredAt', type: 'text' },
  ]),
  [
    { name: 'name', type: 'text' },
    { name: 'registeredAt', type: 'text' },
  ],
  'schema upgrade must delete the legacy field and its stored values',
);
assert.deepEqual(
  withoutRecoverableTenantCredentialField([
    { name: 'registeredEmail', type: 'text' },
    { name: 'registeredPasswordCipher', type: 'text' },
  ]),
  [{ name: 'registeredEmail', type: 'text' }],
  'runtime delivery schema sync must not recreate or preserve the legacy field',
);

const migrationSource = read('scripts/migrate-production-data.ts');
assert.ok(
  migrationSource.indexOf('consumeMigrationApplyIntent(process.env)') < migrationSource.indexOf('dotenv.config'),
  'apply intent must be captured before dotenv can load persistent configuration',
);
assert.doesNotMatch(
  migrationSource.slice(migrationSource.indexOf('dotenv.config')),
  /(?:const|let|var)\s+apply\s*=\s*[^;]*process\.env\.MIGRATION_APPLY/,
  'persisted dotenv values must not be able to arm migration writes',
);
assert.doesNotMatch(migrationSource, /decryptRegistrationPassword/, 'migration must never recover an old customer password');
assert.doesNotMatch(migrationSource, /registeredPasswordCipher\s*:/, 'migration tenant payload must never copy ciphertext');
assert.doesNotMatch(migrationSource, /passwordConfirm/, 'migration must not create or rotate users with recovered credentials');
assert.match(migrationSource, /preflightPasswordResets[\s\S]*?assertPasswordResetMigrationGate/, 'reset-required accounts must be discovered before migration writes');
assert.match(migrationSource, /listAllUsers[\s\S]*?assertOrganizationRoleMigrationGate/, 'missing or invalid user roles must block apply before migration writes');
assert.match(migrationSource, /default_authorized:\s*migratedSupportDefaultAuthorized/, 'support authorization migration must use the fail-closed converter');
assert.match(migrationSource, /readLocalTenantMigrationSource\(\)/, 'tenant migration input must be required instead of silently defaulting to an empty list');
const sourceReader = migrationSource.slice(
  migrationSource.indexOf('export function readLocalTenantMigrationSource'),
  migrationSource.indexOf('function writeSecureJson'),
);
assert.doesNotMatch(sourceReader, /write|mkdir|rename|unlink/, 'migration source reads must be side-effect free');
assert.match(migrationSource, /if \(apply\)[\s\S]*?source\.hadRecoverableCredentials[\s\S]*?writeSecureJson\(source\.file, tenants\)/, 'source credential cleanup must be explicit and apply-only');
assert.match(migrationSource, /if \(!apply \|\| !persistenceAuthorized\)/, 'all local persistence must have an apply-plus-validation guard');
assert.match(migrationSource, /duplicate_registered_email/, 'duplicate tenant identities must enter the release-blocking manifest');
assert.match(migrationSource, /missing_registered_email/, 'formal tenants without a login identity must enter the release-blocking manifest');

const syncSource = read('scripts/sync-demo-accounts.ts');
assert.match(syncSource, /DEMO_ACCOUNT_BOOTSTRAP_JSON is required/, 'demo sync must fail closed without explicit one-time input');
assert.doesNotMatch(syncSource, /entry\.password|filter\(\(entry\) => entry\.email && entry\.password\)/, 'demo sync must never read a password from registry entries');
assert.match(syncSource, /oneTimeBootstrapJson = process\.env\.DEMO_ACCOUNT_BOOTSTRAP_JSON;[\s\S]*?delete process\.env\.DEMO_ACCOUNT_BOOTSTRAP_JSON;[\s\S]*?dotenv\.config/, 'bootstrap secret must come from the invocation environment, not a persisted dotenv file');
assert.match(syncSource, /delete process\.env\.DEMO_ACCOUNT_BOOTSTRAP_JSON/, 'one-time input must be removed from the mutable process environment');
assert.match(syncSource, /writeRegistry\(nextRegistry\)/, 'registry updates must pass through the credential scrubber');
assert.match(syncSource, /writeSecureRegistryFile\(REGISTRY_BACKUP_FILE, contents\)/, 'registry backup must be scrubbed alongside the primary file');
assert.match(syncSource, /uncoveredLegacyAccounts[\s\S]*?explicit reset before scrub/, 'bootstrap must cover every legacy registry credential before scrub');
assert.match(syncSource, /assertDemoBootstrapActivationAllowed\(entry\)/, 'expired trial accounts must not be reactivated implicitly');
assert.match(syncSource, /if \(!isPocketBaseNotFound\(error\)\) throw error/, 'only a confirmed tenant 404 may trigger tenant recreation');
assert.match(syncSource, /registeredEmail = \"\$\{escapeFilterValue\(email\)\}\"/, 'retries must discover a tenant created before a partial failure');
assert.match(syncSource, /catch \(error\)[\s\S]*?isPocketBaseNotFound[\s\S]*?findOne\(token, 'tenants', `registeredEmail[\s\S]*?createTenant/, 'stale tenant ids must recheck the stable email identity before creating a replacement');
assert.match(syncSource, /checkpointTenant\(tenantId\)[\s\S]*?const userPayload/, 'tenant identity must be checkpointed before the user write');
assert.match(syncSource, /if \(summary\.failed === 0\) writeRegistry\(nextRegistry\)/, 'registry scrub must occur only after every explicit bootstrap succeeds');

const setupSource = read('scripts/setup-pb.ts');
const tenantSchema = setupSource.slice(
  setupSource.indexOf("name: 'tenants'"),
  setupSource.indexOf("name: 'trend_videos'"),
);
assert.doesNotMatch(tenantSchema, /registeredPasswordCipher/, 'fresh tenant schema must not create a recoverable password field');
assert.match(setupSource, /removeLegacyRegistrationCredentialField[\s\S]*?withoutLegacyRegistrationCredentialField/, 'schema upgrade must remove the historical field');
assert.match(setupSource, /await removeLegacyRegistrationCredentialField\(token\)/, 'schema cleanup must run during every setup');

const runtimeSchemaSource = read('server/storage/ensureDeliveryCollections.ts');
const runtimeTenantSchema = runtimeSchemaSource.slice(
  runtimeSchemaSource.indexOf('const TENANTS_FIELDS'),
  runtimeSchemaSource.indexOf('const TENANT_PLATFORM_APP_FIELDS'),
);
assert.doesNotMatch(runtimeTenantSchema, /registeredPasswordCipher/, 'runtime tenant schema must not create the legacy field');
assert.match(runtimeSchemaSource, /removeRecoverableCredential[\s\S]*?withoutRecoverableTenantCredentialField/, 'runtime schema upgrades must delete existing legacy fields');

const historicalTenantMigration = read('pb_migrations/1788499501_updated_tenants.js');
assert.match(
  historicalTenantMigration,
  /registeredPasswordCipher|text647047860/,
  'the reviewed historical migration must remain immutable; credential removal belongs in a forward migration',
);
const pocketBaseMigrationFiles = fs.readdirSync(path.join(root, 'pb_migrations'))
  .filter(file => file.endsWith('.js'))
  .sort();
const historicalTenantMigrationIndex = pocketBaseMigrationFiles.indexOf('1788499501_updated_tenants.js');
const credentialRemovalMigrationIndex = pocketBaseMigrationFiles.indexOf('1789084800_remove_registered_password_cipher.js');
assert.ok(
  historicalTenantMigrationIndex >= 0 && credentialRemovalMigrationIndex > historicalTenantMigrationIndex,
  'fresh installs must apply the irreversible credential cleanup after the immutable historical migration',
);
const postCleanupMigrationCorpus = pocketBaseMigrationFiles
  .slice(credentialRemovalMigrationIndex)
  .map(file => read(path.join('pb_migrations', file)))
  .join('\n');
assert.doesNotMatch(
  postCleanupMigrationCorpus,
  /\bname\s*:\s*["']registeredPasswordCipher["']/,
  'no migration at or after the cleanup may recreate the recoverable credential field',
);

const credentialRemovalMigration = read('pb_migrations/1789084800_remove_registered_password_cipher.js');
let forwardMigration: ((app: unknown) => unknown) | undefined;
let rollbackMigration: ((app: unknown) => unknown) | undefined;
vm.runInNewContext(credentialRemovalMigration, {
  migrate: (forward: (app: unknown) => unknown, rollback: (app: unknown) => unknown) => {
    forwardMigration = forward;
    rollbackMigration = rollback;
  },
});
assert.ok(forwardMigration, 'credential cleanup migration must register a forward migration');
assert.ok(rollbackMigration, 'credential cleanup migration must register a rollback migration');

const removedFieldIds: string[] = [];
let savedCollections = 0;
const existingLegacyField = { id: 'legacy-password-field-id' };
const tenantCollection = {
  fields: {
    getByName: (name: string) => {
      assert.equal(name, 'registeredPasswordCipher');
      return existingLegacyField;
    },
    removeById: (id: string) => removedFieldIds.push(id),
  },
};
forwardMigration({
  findCollectionByNameOrId: (name: string) => {
    assert.equal(name, 'tenants');
    return tenantCollection;
  },
  save: (collection: unknown) => {
    assert.equal(collection, tenantCollection);
    savedCollections += 1;
  },
});
assert.deepEqual(removedFieldIds, ['legacy-password-field-id']);
assert.equal(savedCollections, 1, 'existing PocketBase databases must persist deletion of the legacy field');

let absentFieldSaveCalls = 0;
assert.doesNotThrow(() => forwardMigration?.({
  findCollectionByNameOrId: () => ({
    fields: {
      getByName: () => undefined,
      removeById: () => assert.fail('an absent field must not be removed'),
    },
  }),
  save: () => { absentFieldSaveCalls += 1; },
}));
assert.equal(absentFieldSaveCalls, 0, 'corrected fresh databases must treat cleanup as an idempotent no-op');
assert.doesNotThrow(() => forwardMigration?.({
  findCollectionByNameOrId: () => ({
    fields: {
      getByName: () => { throw new Error('field not found'); },
      removeById: () => assert.fail('an absent field must not be removed'),
    },
  }),
  save: () => assert.fail('an absent field must not trigger a schema write'),
}));

let rollbackMutationCalls = 0;
rollbackMigration({
  findCollectionByNameOrId: () => { rollbackMutationCalls += 1; },
  save: () => { rollbackMutationCalls += 1; },
});
assert.equal(rollbackMutationCalls, 0, 'rollback must never recreate a recoverable credential field');

const productApiMigrationName = '1789776000_harden_tenant_api_keys.js';
const productApiMigrationIndex = pocketBaseMigrationFiles.indexOf(productApiMigrationName);
const historicalProductApiMigrationIndex = pocketBaseMigrationFiles.indexOf('1788500322_created_tenant_api_keys.js');
assert.ok(
  productApiMigrationIndex > historicalProductApiMigrationIndex,
  'Product API plaintext cleanup must be a forward migration after the immutable historical schema',
);
const productApiMigrationSource = read(path.join('pb_migrations', productApiMigrationName));
assert.match(productApiMigrationSource, /credential_status[\s\S]*requires_rotation/);
assert.match(productApiMigrationSource, /record\.set\("api_key", ""\)/, 'legacy key bytes must be cleared before schema removal');
assert.match(productApiMigrationSource, /fields\.removeById\(legacyField\.id\)/, 'the plaintext field must be removed from the schema');
assert.doesNotMatch(
  productApiMigrationSource,
  /createHmac|sha256\([^)]*api_key|key_hmac[^\n]*api_key/,
  'the migration must never turn historical plaintext keys into reusable digests',
);

let hardenProductApiMigration: ((app: unknown) => unknown) | undefined;
let rollbackProductApiMigration: ((app: unknown) => unknown) | undefined;
vm.runInNewContext(productApiMigrationSource, {
  Field: class Field {
    [key: string]: unknown;
    constructor(definition: Record<string, unknown>) { Object.assign(this, definition); }
  },
  migrate: (forward: (app: unknown) => unknown, rollback: (app: unknown) => unknown) => {
    hardenProductApiMigration = forward;
    rollbackProductApiMigration = rollback;
  },
});
assert.ok(hardenProductApiMigration);
assert.ok(rollbackProductApiMigration);

const productApiFields: Array<Record<string, unknown>> = [{
  id: 'legacy-product-api-key-field',
  name: 'api_key',
  required: true,
}];
const removedProductApiFieldIds: string[] = [];
const productApiIndexes = new Map<string, { unique: boolean; fields: string; where: string }>([
  ['idx_tenant_api_keys_key', { unique: true, fields: 'api_key', where: '' }],
]);
const productApiCollection = {
  fields: {
    get length() { return productApiFields.length; },
    getByName: (name: string) => productApiFields.find(field => field.name === name),
    addAt: (_index: number, field: Record<string, unknown>) => { productApiFields.push(field); },
    removeById: (id: string) => {
      removedProductApiFieldIds.push(id);
      const index = productApiFields.findIndex(field => field.id === id);
      if (index >= 0) productApiFields.splice(index, 1);
    },
  },
  removeIndex: (name: string) => { productApiIndexes.delete(name); },
  addIndex: (name: string, unique: boolean, fields: string, where: string) => {
    productApiIndexes.set(name, { unique, fields, where });
  },
};
const legacyProductApiRecord: Record<string, unknown> = {
  api_key: 'legacy-plaintext-product-api-key',
};
const savedProductApiObjects: unknown[] = [];
hardenProductApiMigration({
  findCollectionByNameOrId: (name: string) => {
    assert.equal(name, 'tenant_api_keys');
    return productApiCollection;
  },
  findAllRecords: (name: string) => {
    assert.equal(name, 'tenant_api_keys');
    return [{ set: (field: string, value: unknown) => { legacyProductApiRecord[field] = value; } }];
  },
  save: (value: unknown) => { savedProductApiObjects.push(value); },
});
assert.equal(legacyProductApiRecord.api_key, '', 'migration must erase the historical bearer before dropping its field');
assert.equal(legacyProductApiRecord.credential_status, 'requires_rotation');
assert.equal(legacyProductApiRecord.key_hmac, '', 'migration must not derive a digest from the historical bearer');
assert.deepEqual(removedProductApiFieldIds, ['legacy-product-api-key-field']);
assert.equal(productApiFields.some(field => field.name === 'api_key'), false);
assert.equal(productApiFields.some(field => field.name === 'key_hmac'), true);
assert.equal(productApiIndexes.has('idx_tenant_api_keys_key'), false);
assert.deepEqual(productApiIndexes.get('idx_tenant_api_keys_key_id'), {
  unique: true,
  fields: 'key_id',
  where: "key_id != ''",
});
assert.ok(savedProductApiObjects.length >= 3, 'schema, revoked records, and field removal must all be persisted');

let productApiRollbackMutations = 0;
rollbackProductApiMigration({
  findCollectionByNameOrId: () => { productApiRollbackMutations += 1; },
  save: () => { productApiRollbackMutations += 1; },
});
assert.equal(productApiRollbackMutations, 0, 'rollback must never recreate plaintext Product API storage');

console.log('credential migration script security tests passed');
