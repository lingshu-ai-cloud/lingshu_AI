import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  claimLocalTenantInvite,
  createLocalInviteTenant,
  finalizeLocalTenantInvite,
  listLocalTenants,
  releaseLocalTenantInviteClaim,
} from '../lib/localTenants.js';
import { decryptRegistrationPassword, encryptRegistrationPassword } from '../lib/registrationCredentials.js';
import {
  credentialMask,
  decryptCredential,
  encryptCredential,
  validCredentialEncryptionKey,
  type CredentialContext,
} from './credentialEnvelope.js';
import { safeProviderError } from './providerError.js';
import { normalizeOAuthReturnTo, safeInlineJson, secureOAuthCallbackResponse } from './oauthCallbackHtml.js';
import { parseStoredOAuthConfig } from '../lib/oauthConfig.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

const previousCredentialKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
process.env.CREDENTIAL_ENCRYPTION_KEY = 'credential-envelope-test-key-abcdefghijklmnopqrstuvwxyz-0123456789';
try {
  const context: CredentialContext = {
    scope: 'social_account', tenantId: 'tenant-a', recordId: 'account-a', platform: 'facebook', field: 'accessToken',
  };
  const secret = 'EA-test-provider-secret-value';
  const envelope = encryptCredential(secret, context);
  assert.match(envelope, /^cred:v1:/);
  assert.doesNotMatch(envelope, new RegExp(secret));
  assert.deepEqual(decryptCredential(envelope, context), { ok: true, value: secret });
  assert.equal(credentialMask(envelope, context), '********');
  for (const changed of [
    { ...context, tenantId: 'tenant-b' },
    { ...context, recordId: 'account-b' },
    { ...context, platform: 'instagram' },
    { ...context, field: 'refreshToken' },
  ]) {
    assert.equal(decryptCredential(envelope, changed).ok, false, 'AAD must bind tenant, record, platform, and field');
  }
  // Flip an actual ciphertext bit. Replacing only the final base64url
  // character is flaky because its unused padding bits can decode to the
  // original byte sequence for some randomly generated envelopes.
  const tamperedParts = envelope.split(':');
  const tamperedCiphertext = Buffer.from(tamperedParts[5], 'base64url');
  tamperedCiphertext[0] ^= 1;
  tamperedParts[5] = tamperedCiphertext.toString('base64url');
  const tampered = tamperedParts.join(':');
  assert.equal(decryptCredential(tampered, context).ok, false);
  assert.deepEqual(decryptCredential('legacy-plaintext-token', context), { ok: false, reason: 'legacy_plaintext' });
  assert.deepEqual(decryptCredential('v1:iv:tag:ciphertext', context), { ok: false, reason: 'legacy_plaintext' });
  assert.deepEqual(decryptCredential('cred:v2:key:nonce:tag:ciphertext', context), { ok: false, reason: 'unknown_version' });
  assert.equal(validCredentialEncryptionKey(`base64:${Buffer.alloc(32, 7).toString('base64')}`), true);
  assert.equal(validCredentialEncryptionKey(`hex:${Buffer.alloc(32, 8).toString('hex')}`), true);
  assert.equal(validCredentialEncryptionKey('base64:not-valid-@@@'), false);
  assert.equal(validCredentialEncryptionKey('hex:not-hex-at-all-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'), false);

  const safe = safeProviderError({
    code: 'ERR_BAD_REQUEST',
    message: 'authorization=Bearer ya29.top-secret-token client_secret=super-secret-value',
    response: { status: 401, config: { headers: { authorization: 'Bearer raw-token' } } },
  });
  assert.equal(safe.status, 401);
  assert.doesNotMatch(JSON.stringify(safe), /ya29|top-secret|super-secret|raw-token/);
  const malicious = '</script><script>globalThis.pwned=true</script>\u2028';
  const inline = safeInlineJson({ message: malicious });
  assert.doesNotMatch(inline, /<\/script>|<script>|[\u2028\u2029]/);
  assert.deepEqual(JSON.parse(inline), { message: malicious });
  assert.equal(normalizeOAuthReturnTo('//evil.example/steal'), '/');
  assert.equal(normalizeOAuthReturnTo('/\\evil.example/steal'), '/');
  assert.equal(normalizeOAuthReturnTo('/dashboard?tab=oauth#secret'), '/dashboard?tab=oauth');
  const headers = new Map<string, string>();
  const nonce = secureOAuthCallbackResponse({
    setHeader: (name: string, value: string) => headers.set(name, value),
  } as never);
  assert.match(nonce, /^[a-zA-Z0-9_-]+$/);
  assert.match(headers.get('Content-Security-Policy') || '', new RegExp(`script-src 'nonce-${nonce}'`));
  assert.doesNotMatch(headers.get('Content-Security-Policy') || '', /unsafe-inline/);
  assert.deepEqual(parseStoredOAuthConfig('{"revision":2,"disabledPlatforms":["meta"]}').disabledPlatforms, ['meta']);
  assert.throws(() => parseStoredOAuthConfig('{broken'), /oauth_config_invalid_json/);
  assert.throws(() => parseStoredOAuthConfig('{"revision":-1}'), /oauth_config_invalid_revision/);
} finally {
  if (previousCredentialKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  else process.env.CREDENTIAL_ENCRYPTION_KEY = previousCredentialKey;
}

assert.equal(decryptRegistrationPassword('legacy-plaintext-password'), '', 'legacy plaintext must fail closed');
assert.equal(decryptRegistrationPassword('v1:iv:tag:ciphertext'), '', 'legacy ciphertext must not be recoverable');
assert.equal(encryptRegistrationPassword('must-not-be-persisted'), '', 'retired writer must fail closed');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-invite-claim-'));
const previousFile = process.env.LOCAL_TENANTS_FILE;
process.env.LOCAL_TENANTS_FILE = path.join(temporary, 'tenants.json');
try {
  createLocalInviteTenant({ companyName: '并发测试企业', inviteCode: 'single-use-code' });
  const attempts = await Promise.all(Array.from({ length: 16 }, async (_, index) => (
    claimLocalTenantInvite({ inviteCode: 'single-use-code', email: `owner${index}@example.com` })
  )));
  const winners = attempts.filter((item): item is NonNullable<typeof item> => Boolean(item));
  assert.equal(winners.length, 1, 'a local invite must have exactly one concurrent claim winner');

  assert.equal(releaseLocalTenantInviteClaim({ inviteCode: 'single-use-code', claimToken: winners[0].claimToken }), true);
  const retry = claimLocalTenantInvite({ inviteCode: 'single-use-code', email: 'owner@example.com' });
  assert.ok(retry, 'released invite must be safely retryable');
  const finalized = finalizeLocalTenantInvite({
    inviteCode: 'single-use-code',
    email: 'owner@example.com',
    claimToken: retry.claimToken,
  });
  assert.ok(finalized, 'claim owner must be able to finalize');
  assert.equal(claimLocalTenantInvite({ inviteCode: 'single-use-code', email: 'second@example.com' }), null);
  assert.equal(listLocalTenants()[0].registeredPasswordCipher, undefined, 'local tenant must not retain a password cipher');
} finally {
  if (previousFile === undefined) delete process.env.LOCAL_TENANTS_FILE;
  else process.env.LOCAL_TENANTS_FILE = previousFile;
  fs.rmSync(temporary, { recursive: true, force: true });
}

const authRoute = source('server/routes/auth.ts');
const registerStart = authRoute.indexOf("authRouter.post('/register'");
const loginStart = authRoute.indexOf("authRouter.post('/login'");
const registerRoute = authRoute.slice(registerStart, loginStart);
assert.ok(registerRoute.indexOf('claimRemoteTenantInvite') < registerRoute.indexOf("pbCreate('users'"), 'remote invite claim must precede user creation');
assert.match(registerRoute, /pbDelete\('users'/, 'remote partial failure must compensate the created user');
assert.match(registerRoute, /releaseRemoteTenantInviteClaim/, 'remote partial failure must release its claim');
assert.doesNotMatch(authRoute, /encryptRegistrationPassword|registeredPasswordCipher/, 'auth flows must never persist recoverable passwords');

const adminRoute = source('server/routes/admin.ts');
const accountResponse = adminRoute.slice(adminRoute.indexOf("adminRouter.get('/demo-accounts'"), adminRoute.indexOf("adminRouter.post('/trial-accounts"));
assert.doesNotMatch(accountResponse, /decryptRegistrationPassword|rotationPassword|\bpassword\s*:/, 'admin account response must expose no password field');
const oauthResponse = adminRoute.slice(adminRoute.indexOf('function publicOAuthConfig'), adminRoute.indexOf("adminRouter.get('/demo-accounts'"));
const oauthValues = oauthResponse.slice(oauthResponse.indexOf('values:'), oauthResponse.indexOf('secretSet:'));
assert.doesNotMatch(oauthValues, /(youtubeOAuthClientSecret|metaSocialAppSecret|tiktokClientSecret)\s*:/, 'admin OAuth GET must not return a client secret field');
assert.match(oauthResponse, /secretSet:[\s\S]*?secretMask:/, 'admin OAuth GET may expose only configured state and a fixed mask');
const deliverySerializer = adminRoute.slice(adminRoute.indexOf('function adminTenantPlatformApp'), adminRoute.indexOf('function publicDeliveryTenant'));
assert.doesNotMatch(deliverySerializer, /decrypt|app_secret|access_token|appSecret\s*:/, 'delivery admin serializer must remain write-only');

const oauthConfigSource = source('server/lib/oauthConfig.ts');
assert.match(oauthConfigSource, /fs\.fsyncSync\(descriptor\)[\s\S]*?fs\.renameSync\(temporary, CONFIG_FILE\)/, 'global OAuth config writes must fsync and atomically rename');
assert.match(oauthConfigSource, /expectedRevision[\s\S]*?oauth_config_write_conflict/, 'global OAuth config writes must reject stale revisions');
assert.match(oauthConfigSource, /storedSecret\(stored\.youtubeOAuthClientSecret/, 'global OAuth secrets must decrypt only as authenticated envelopes');
assert.match(oauthConfigSource, /lstatSync\(CONFIG_FILE\)/, 'global OAuth config corruption and permission errors must fail closed');
assert.match(oauthConfigSource, /oauthConfigurationHealthCheck/, 'global OAuth config integrity must participate in readiness');

const platformCredentialSource = source('server/security/platformCredentials.ts');
assert.match(platformCredentialSource, /quarantineAccountCredentials[\s\S]*?credentialState: 'reconnect_required'/, 'invalid account credentials must be quarantined and require reconnection');
for (const route of ['server/routes/youtube.ts', 'server/routes/social.ts', 'server/routes/socialEngagement.ts', 'server/publishing/platformPublisher.ts']) {
  const code = source(route);
  assert.doesNotMatch(code, /account\.(?:clientSecret|refreshToken|accessToken)\b|record\.(?:clientSecret|refreshToken|accessToken)\b/, `${route} must not pass stored envelopes directly to providers`);
}
for (const route of ['server/routes/youtube.ts', 'server/routes/social.ts']) {
  const code = source(route);
  assert.match(code, /safeInlineJson\(payload\)[\s\S]*?postMessage\(payload, targetOrigin\)/, `${route} must escape inline JSON and pin postMessage targetOrigin`);
  assert.match(code, /secureOAuthCallbackResponse\(res\)/, `${route} OAuth callbacks must disable caching and set a restrictive CSP`);
  assert.match(code, /<script nonce="\$\{input\.nonce\}">/, `${route} OAuth callback script must carry its per-response CSP nonce`);
  assert.doesNotMatch(code, /postMessage\(payload,\s*["']\*["']\)|JSON\.stringify\(payload\)/, `${route} must not use wildcard postMessage or raw inline JSON`);
}
const youtubeRoute = source('server/routes/youtube.ts');
assert.doesNotMatch(youtubeRoute, /console\.(?:error|warn)\([^\n]*?(?:\?\.response\?\.data|,\s*error\s*\))/, 'YouTube logs must never serialize provider error objects');
assert.match(youtubeRoute, /safeProviderError\(error\)/, 'YouTube logs must use a redacted provider error projection');

const credentialMigration = source('pb_migrations/1788307205_encrypt_platform_credentials.js');
assert.match(credentialMigration, /!value\.startsWith\("cred:v1:"\)/, 'legacy platform secrets must not be silently wrapped as trusted envelopes');
assert.match(credentialMigration, /record\.set\(field, ""\)[\s\S]*?reconnect_required/, 'legacy platform secrets must be cleared and marked for reconnection');

const demoRegistry = source('server/lib/demoAccounts.ts');
assert.match(demoRegistry, /password: _password, rotationPassword: _rotationPassword/, 'legacy registry secrets must be scrubbed');
assert.doesNotMatch(demoRegistry, /rotationPassword:\s*password/, 'generated rotation passwords must never be stored');
assert.doesNotMatch(demoRegistry, /entry\.tenantId === id\.tenantId/, 'a shared tenant id must never promote an ordinary member to administrator');
assert.match(demoRegistry, /entry\.userId === id\.userId/, 'administrator registry fallback must bind the exact authenticated user');

const setup = source('scripts/setup-pb.ts');
assert.match(setup, /role: 'super_admin'/, 'workbench admin must have an explicit super_admin role');
assert.match(setup, /name: 'role', type: 'select', required: true/, 'fresh users schema must require role');
assert.match(setup, /migrateAndHardenUsers/, 'legacy users must be migrated before schema validation');
assert.match(source('pb_hooks/atomic.pb.js'), /tenants: true/, 'tenant invite claims must use the transactional CAS allow-list');
assert.match(source('server/storage/canonicalSchema.ts'), /idx_users_single_super_admin/, 'database schema must prohibit two super_admin users per tenant');

const serverStartup = source('server/index.ts');
assert.match(
  serverStartup,
  /if \(process\.env\.NODE_ENV !== 'production'\) \{[\s\S]*?\.env\.local'[\s\S]*?override: true/,
  'production startup must not let a developer .env.local downgrade mode or override injected secrets',
);
assert.match(serverStartup, /readyz'[\s\S]*?operationalTokenMatches[\s\S]*?\{ status: snapshot\.status \}/, 'anonymous production readiness must not expose internal check details');
assert.match(source('server/ops/health.ts'), /schemaCheckInFlight/, 'canonical schema readiness must coalesce concurrent refreshes');
assert.match(source('Caddyfile'), /\?Content-Security-Policy/, 'edge CSP must preserve stricter per-response OAuth callback policies');

const migration = source('scripts/migrate-production-data.ts');
assert.doesNotMatch(migration, /decryptRegistrationPassword|passwordConfirm/, 'production migration must not recover or re-save passwords');

console.log('credential storage, admin responses, and single-use invite claims stay fail-closed');
