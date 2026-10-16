import assert from 'node:assert/strict';
import { apiRateLimitConfig, createRateLimiter, jsonBodyLimits, requestSafetyHeaders } from './httpSafety.js';

let timestamp = 1_000;
const limiter = createRateLimiter({ windowMs: 1_000, limit: 2, maxKeys: 10, now: () => timestamp });
const headers = new Map<string, string>();
let status = 200;
let body: unknown;
const response = {
  setHeader(name: string, value: string) { headers.set(name, value); },
  status(value: number) { status = value; return this; },
  json(value: unknown) { body = value; return this; },
};
const request = { headers: { authorization: 'Bearer opaque' }, ip: '127.0.0.1', socket: {} };
let allowed = 0;
limiter(request as never, response as never, () => { allowed += 1; });
limiter(request as never, response as never, () => { allowed += 1; });
limiter(request as never, response as never, () => { allowed += 1; });
assert.equal(allowed, 2);
assert.equal(status, 429);
assert.deepEqual(body, { error: 'rate_limit_exceeded', retryAfterSeconds: 1 });

const rotatedHeaderLimiter = createRateLimiter({ windowMs: 1_000, limit: 2, maxKeys: 10, now: () => timestamp });
let rotatedAllowed = 0;
for (const authorization of ['Bearer invalid-a', 'Bearer invalid-b', 'Bearer invalid-c']) {
  status = 200;
  rotatedHeaderLimiter(
    { headers: { authorization }, ip: '203.0.113.10', socket: {} } as never,
    response as never,
    () => { rotatedAllowed += 1; },
  );
}
assert.equal(rotatedAllowed, 2, 'rotating unverified bearer text must not bypass the IP overload guard');
assert.equal(status, 429);
timestamp = 2_001;
limiter(request as never, response as never, () => { allowed += 1; });
assert.equal(allowed, 3, 'the principal should receive a new bucket after the window');

process.env.LEGACY_JSON_UPLOAD_LIMIT_MB = '500';
process.env.DEFAULT_JSON_BODY_LIMIT_MB = '0';
assert.deepEqual(jsonBodyLimits(), { default: 2, legacyUpload: 64, voiceUpload: 24 });
delete process.env.LEGACY_JSON_UPLOAD_LIMIT_MB;
delete process.env.DEFAULT_JSON_BODY_LIMIT_MB;

const safetyHeaders = new Map<string, string>();
let safetyNext = 0;
requestSafetyHeaders({} as never, {
  setHeader(name: string, value: string) { safetyHeaders.set(name, value); },
  getHeader(name: string) { return safetyHeaders.get(name); },
} as never, () => { safetyNext += 1; });
assert.equal(safetyNext, 1);
assert.equal(safetyHeaders.get('Permissions-Policy'), 'camera=(self), microphone=(self), geolocation=()');
assert.ok(safetyHeaders.get('X-Request-Id'));

async function invokeRateLimiter(
  target: ReturnType<typeof createRateLimiter>,
  input: { authorization?: string; tenantHeader?: string; ip?: string },
): Promise<{ allowed: boolean; status: number; body: unknown }> {
  return new Promise(resolve => {
    let responseStatus = 200;
    let responseBody: unknown;
    const finish = (allowedResult: boolean) => resolve({
      allowed: allowedResult,
      status: responseStatus,
      body: responseBody,
    });
    target({
      headers: {
        ...(input.authorization ? { authorization: input.authorization } : {}),
        ...(input.tenantHeader ? { 'x-tenant-id': input.tenantHeader } : {}),
      },
      ip: input.ip || '198.51.100.1',
      socket: {},
    } as never, {
      setHeader() {},
      status(value: number) { responseStatus = value; return this; },
      json(value: unknown) { responseBody = value; finish(false); return this; },
    } as never, () => finish(true));
  });
}

let verifiedAuthorization = '';
const exactExemptionLimiter = createRateLimiter({
  windowMs: 1_000,
  limit: 1,
  now: () => 10_000,
  exemptTenantIds: new Set(['tenant-aurelia']),
  exemptUserIds: new Set(['user-aurelia']),
  verifyIdentity: async authorization => {
    verifiedAuthorization = String(authorization || '');
    return authorization === 'Bearer valid-aurelia'
      ? { tenantId: 'tenant-aurelia', userId: 'user-aurelia' }
      : null;
  },
});
assert.equal((await invokeRateLimiter(exactExemptionLimiter, { authorization: 'Bearer valid-aurelia' })).allowed, true);
assert.equal(verifiedAuthorization, '', 'normal traffic must not pay the authentication cost for an exemption');
assert.equal((await invokeRateLimiter(exactExemptionLimiter, { authorization: 'Bearer valid-aurelia' })).allowed, true);
assert.equal(verifiedAuthorization, 'Bearer valid-aurelia', 'only the trusted verifier may resolve the exempt principal');

const exactUserExemptionLimiter = createRateLimiter({
  windowMs: 1_000,
  limit: 1,
  now: () => 10_000,
  exemptUserIds: new Set(['user-aurelia']),
  verifyIdentity: async () => ({ tenantId: 'tenant-other', userId: 'user-aurelia' }),
});
assert.equal((await invokeRateLimiter(exactUserExemptionLimiter, {})).allowed, true);
assert.equal((await invokeRateLimiter(exactUserExemptionLimiter, {
  authorization: 'Bearer valid-user',
})).allowed, true, 'an exact verified account ID may be exempt independently of its tenant');

const spoofedHeaderLimiter = createRateLimiter({
  windowMs: 1_000,
  limit: 1,
  now: () => 10_000,
  exemptTenantIds: new Set(['tenant-aurelia']),
  verifyIdentity: async () => null,
});
assert.equal((await invokeRateLimiter(spoofedHeaderLimiter, {})).allowed, true);
const spoofed = await invokeRateLimiter(spoofedHeaderLimiter, {
  authorization: 'Bearer forged',
  tenantHeader: 'tenant-aurelia',
});
assert.equal(spoofed.allowed, false, 'a client-supplied tenant header must never bypass the overload guard');
assert.equal(spoofed.status, 429);
assert.deepEqual(spoofed.body, { error: 'rate_limit_exceeded', retryAfterSeconds: 1 });

let attackerVerificationCalls = 0;
const boundedVerificationLimiter = createRateLimiter({
  windowMs: 1_000,
  limit: 1,
  now: () => 10_000,
  exemptTenantIds: new Set(['tenant-aurelia']),
  verifyIdentity: async () => { attackerVerificationCalls += 1; return null; },
});
await invokeRateLimiter(boundedVerificationLimiter, {});
for (let attempt = 0; attempt < 40; attempt += 1) {
  const result = await invokeRateLimiter(boundedVerificationLimiter, {
    authorization: `Bearer forged-${attempt}`,
  });
  assert.equal(result.status, 429);
}
assert.equal(attackerVerificationCalls, 32, 'rotated bearer strings must not create unbounded auth work');

const originalExemptTenants = process.env.API_RATE_LIMIT_EXEMPT_TENANT_IDS;
const originalExemptUsers = process.env.API_RATE_LIMIT_EXEMPT_USER_IDS;
process.env.API_RATE_LIMIT_EXEMPT_TENANT_IDS = 'tenant-exact,*,tenant/not-an-id';
process.env.API_RATE_LIMIT_EXEMPT_USER_IDS = 'user-exact,user-*';
const parsedExemptions = apiRateLimitConfig();
assert.deepEqual([...parsedExemptions.exemptTenantIds], ['tenant-exact']);
assert.deepEqual([...parsedExemptions.exemptUserIds], ['user-exact']);
if (originalExemptTenants === undefined) delete process.env.API_RATE_LIMIT_EXEMPT_TENANT_IDS;
else process.env.API_RATE_LIMIT_EXEMPT_TENANT_IDS = originalExemptTenants;
if (originalExemptUsers === undefined) delete process.env.API_RATE_LIMIT_EXEMPT_USER_IDS;
else process.env.API_RATE_LIMIT_EXEMPT_USER_IDS = originalExemptUsers;

console.log('HTTP safety controls passed');
