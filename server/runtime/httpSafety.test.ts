import assert from 'node:assert/strict';
import { createRateLimiter, jsonBodyLimits, requestSafetyHeaders } from './httpSafety.js';

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
console.log('HTTP safety controls passed');
