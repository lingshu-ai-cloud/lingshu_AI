import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalCwd = process.cwd();
const temporaryCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-support-access-test-'));
const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  SUPPORT_ACCESS_SECRET: process.env.SUPPORT_ACCESS_SECRET,
  SUPPORT_ACCESS_TTL_MINUTES: process.env.SUPPORT_ACCESS_TTL_MINUTES,
  REGISTRATION_CREDENTIAL_KEY: process.env.REGISTRATION_CREDENTIAL_KEY,
  OAUTH_STATE_SECRET: process.env.OAUTH_STATE_SECRET,
};

try {
  process.chdir(temporaryCwd);
  process.env.NODE_ENV = 'test';
  process.env.SUPPORT_ACCESS_SECRET = 'support-access-security-test-secret';
  delete process.env.SUPPORT_ACCESS_TTL_MINUTES;

  const moduleUrl = new URL('./supportAccess.ts', import.meta.url);
  moduleUrl.searchParams.set('security-test', String(Date.now()));
  const {
    createSupportAccessRequest,
    issueSupportAccessToken,
    setSupportAccessDefaultAuthorized,
    supportAccessDefaultAuthorized,
    verifySupportAccessToken,
  } = await import(moduleUrl.href);

  const tenantId = 'tenant-support-security-test';
  assert.equal(supportAccessDefaultAuthorized(tenantId), false, 'support access must default to disabled');

  setSupportAccessDefaultAuthorized(tenantId, 'admin-security-test', true);
  const request = createSupportAccessRequest({
    tenantId,
    tenantName: 'Security test tenant',
    requestedByUserId: 'admin-security-test',
    requestedByEmail: 'security-admin@example.test',
  });

  const realNow = Date.now;
  const currentTime = realNow();
  let expiredSession: ReturnType<typeof issueSupportAccessToken>;
  try {
    Date.now = () => currentTime - 31 * 60 * 1000;
    expiredSession = issueSupportAccessToken(request.id, 'admin-security-test');
  } finally {
    Date.now = realNow;
  }
  assert.ok(expiredSession, 'an approved request must issue a token');
  const expiredEncodedPayload = expiredSession.token.slice('support-v1.'.length).split('.')[0];
  const expiredPayload = JSON.parse(Buffer.from(expiredEncodedPayload, 'base64url').toString('utf8')) as {
    issuedAt: number;
    expiresAt: number;
  };
  assert.equal(expiredPayload.expiresAt - expiredPayload.issuedAt, 30 * 60 * 1000, 'support tokens must default to a 30 minute TTL');
  assert.equal(
    verifySupportAccessToken(`Bearer ${expiredSession.token}`),
    null,
    'an expired support token must be rejected',
  );

  process.env.SUPPORT_ACCESS_TTL_MINUTES = '120';
  const cappedSession = issueSupportAccessToken(request.id, 'admin-security-test');
  assert.ok(cappedSession, 'an approved request must issue a capped token');
  const encodedPayload = cappedSession.token.slice('support-v1.'.length).split('.')[0];
  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
    issuedAt: number;
    expiresAt: number;
  };
  assert.equal(payload.expiresAt - payload.issuedAt, 60 * 60 * 1000, 'configured TTL must never exceed 60 minutes');
  const identity = verifySupportAccessToken(`Bearer ${cappedSession.token}`);
  assert.ok(identity?.supportAccess, 'a current support token must verify');
  assert.equal(identity.supportAccess.expiresAt, cappedSession.expiresAt, 'verified support identity must expose its expiry');

  process.env.NODE_ENV = 'production';
  delete process.env.SUPPORT_ACCESS_SECRET;
  process.env.REGISTRATION_CREDENTIAL_KEY = 'retired-registration-key-must-not-sign-support-access';
  process.env.OAUTH_STATE_SECRET = 'oauth-key-must-not-sign-support-access';
  assert.equal(
    verifySupportAccessToken(`Bearer ${cappedSession.token}`),
    null,
    'verification must reject rather than throw when the dedicated production secret is missing',
  );
  assert.throws(
    () => issueSupportAccessToken(request.id, 'admin-security-test'),
    /SUPPORT_ACCESS_SECRET is required in production/,
    'production support access must not silently reuse an unrelated or retired secret',
  );

  console.log('support access security tests passed');
} finally {
  process.chdir(originalCwd);
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(temporaryCwd, { recursive: true, force: true });
}
