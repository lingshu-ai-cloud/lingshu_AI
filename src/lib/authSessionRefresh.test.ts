import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AuthSessionUnavailableError, getToken, refreshAuthSession, setToken, startInitialAuthSessionRefresh } from './auth.js';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
assert.match(appSource, /return startInitialAuthSessionRefresh\(\{/,
  'the app must retain the loading state and install the cancellable initial-session retry controller');
assert.match(appSource, /if \(!session && sessionRefreshError\) \{/,
  'an exhausted no-token preview bootstrap must show the recoverable connection result instead of the login screen');
assert.match(appSource, /<Result[\s\S]*status="warning"[\s\S]*重新连接/,
  'the blocking session outage must use the shared Ant Result pattern with an explicit retry action');

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  },
});

setToken('verified-token');
await assert.rejects(
  refreshAuthSession(async () => Response.json({ error: 'offline' }, { status: 503 })),
  (error: unknown) => error instanceof AuthSessionUnavailableError && error.status === 503,
);
assert.equal(getToken(), 'verified-token', 'a 503 must preserve the authenticated token');

await assert.rejects(
  refreshAuthSession(async () => { throw new TypeError('network offline'); }),
  AuthSessionUnavailableError,
);
assert.equal(getToken(), 'verified-token', 'a network error must preserve the authenticated token');

values.set('overseas_support_original_token', 'original-operator-token');
setToken('expired-support-token');
let supportCalls = 0;
await assert.rejects(refreshAuthSession(async () => {
  supportCalls += 1;
  return supportCalls === 1
    ? new Response(null, { status: 401 })
    : Response.json({ error: 'offline' }, { status: 503 });
}), AuthSessionUnavailableError);
assert.equal(getToken(), 'expired-support-token', 'a failed original-session check must not switch the retained support UI to a different bearer');
assert.equal(values.get('overseas_support_original_token'), 'original-operator-token');

values.delete('overseas_support_original_token');
setToken('verified-token');
assert.equal(await refreshAuthSession(async () => new Response(null, { status: 401 })), null);
assert.equal(getToken(), null, 'only a terminal authentication response should clear the token');

const previewSession = {
  user: { id: 'preview-user', email: 'beauty-showcase@local.test', name: 'Beauty Showcase', tenantId: 'preview-tenant', role: 'admin' as const },
  tenant: { id: 'preview-tenant', name: 'Beauty Showcase', subscriptionStatus: 'active', subscriptionPlan: 'customer', subscriptionExpiresAt: null },
};
const previewToken = 'local-demo.v1.payload.signature';
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
values.clear();
const freshPreviewRequests: Array<{ url: string; init?: RequestInit }> = [];
const freshPreview = await refreshAuthSession(async (input, init) => {
  freshPreviewRequests.push({ url: String(input), init });
  if (String(input).endsWith('/local-preview-session')) return Response.json({ token: previewToken });
  assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${previewToken}`);
  return Response.json(previewSession);
}, { localPreviewBootstrap: true });
assert.deepEqual(freshPreview, previewSession);
assert.equal(getToken(), previewToken);
assert.deepEqual(freshPreviewRequests.map(request => request.url), [
  '/api/overseas/auth/local-preview-session',
  '/api/overseas/auth/me',
]);
assert.equal(freshPreviewRequests[0]?.init?.method, 'POST');
assert.equal(freshPreviewRequests[0]?.init?.cache, 'no-store');

setToken('stale-local-token');
const recoveryRequests: string[] = [];
const recoveredPreview = await refreshAuthSession(async (input, init) => {
  const url = String(input);
  recoveryRequests.push(url);
  if (recoveryRequests.length === 1) {
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer stale-local-token');
    return new Response(null, { status: 401 });
  }
  if (url.endsWith('/local-preview-session')) return Response.json({ token: previewToken });
  assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${previewToken}`);
  return Response.json(previewSession);
}, { localPreviewBootstrap: true });
assert.deepEqual(recoveredPreview, previewSession);
assert.equal(getToken(), previewToken, 'a terminal stale local token should be replaced by the supervised preview token');
assert.deepEqual(recoveryRequests, [
  '/api/overseas/auth/me',
  '/api/overseas/auth/local-preview-session',
  '/api/overseas/auth/me',
]);

values.clear();
await assert.rejects(
  refreshAuthSession(async () => Response.json({ token: 'not-a-local-preview-token' }), { localPreviewBootstrap: true }),
  (error: unknown) => error instanceof AuthSessionUnavailableError && error.status === 502,
);
assert.equal(getToken(), null, 'a malformed bootstrap response must not install a browser token');

values.clear();
let verificationFailureCalls = 0;
await assert.rejects(
  refreshAuthSession(async (input, init) => {
    verificationFailureCalls += 1;
    if (String(input).endsWith('/local-preview-session')) return Response.json({ token: previewToken });
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${previewToken}`);
    return Response.json({ error: 'starting' }, { status: 503 });
  }, { localPreviewBootstrap: true }),
  (error: unknown) => error instanceof AuthSessionUnavailableError && error.status === 503,
);
assert.equal(verificationFailureCalls, 2);
assert.equal(getToken(), null, 'an unverified preview token must never be installed or stop cold-start retry');

let ordinaryDevRequests = 0;
assert.equal(await refreshAuthSession(async () => {
  ordinaryDevRequests += 1;
  return new Response(null, { status: 500 });
}, { localPreviewBootstrap: false }), null);
assert.equal(ordinaryDevRequests, 0, 'ordinary development must keep the normal explicit-login behavior');

values.clear();
const interleavedTokens = [
  'local-demo.v1.concurrent-one.signature',
  'local-demo.v1.concurrent-two.signature',
];
let issuedTokenIndex = 0;
const verificationResolvers = new Map<string, (response: Response) => void>();
const interleavedFetch: typeof fetch = async (input, init) => {
  if (String(input).endsWith('/local-preview-session')) {
    return Response.json({ token: interleavedTokens[issuedTokenIndex++] });
  }
  const authorization = new Headers(init?.headers).get('authorization') || '';
  return new Promise<Response>(resolve => { verificationResolvers.set(authorization, resolve); });
};
const firstBootstrap = refreshAuthSession(interleavedFetch, { localPreviewBootstrap: true });
const secondBootstrap = refreshAuthSession(interleavedFetch, { localPreviewBootstrap: true });
await flush();
assert.deepEqual([...verificationResolvers.keys()].sort(), interleavedTokens.map(token => `Bearer ${token}`).sort());
verificationResolvers.get(`Bearer ${interleavedTokens[1]}`)!(Response.json(previewSession));
assert.deepEqual(await secondBootstrap, previewSession);
assert.equal(getToken(), interleavedTokens[1]);
verificationResolvers.get(`Bearer ${interleavedTokens[0]}`)!(Response.json(previewSession));
await assert.rejects(
  firstBootstrap,
  (error: unknown) => error instanceof AuthSessionUnavailableError && error.status === 409,
);
assert.equal(getToken(), interleavedTokens[1], 'an older concurrent bootstrap must not overwrite a newer verified token');

values.clear();
type ScheduledRetry = { callback: () => void; delayMs: number; id: number };
const scheduledRetries: ScheduledRetry[] = [];
const cancelledRetries: number[] = [];
const retryDelays: number[] = [];
const initialResults: Array<typeof previewSession | null> = [];
const initialFailures: unknown[] = [];
let initialAttempts = 0;
let nextRetryId = 0;
let stoppedRefreshCalls = 0;
let stoppedRefreshSchedules = 0;
const stopDiscardedRefresh = startInitialAuthSessionRefresh({
  refresh: async () => { stoppedRefreshCalls += 1; return previewSession; },
  getToken,
  schedule: () => { stoppedRefreshSchedules += 1; return stoppedRefreshSchedules; },
  cancel: () => {},
  onSuccess: () => { throw new Error('a disposed refresh must not succeed'); },
  onFailure: () => { throw new Error('a disposed refresh must not fail'); },
});
stopDiscardedRefresh();
await flush();
assert.equal(stoppedRefreshCalls, 0, 'StrictMode cleanup before the microtask must issue no auth request');
assert.equal(stoppedRefreshSchedules, 0);

const stopInitialRefresh = startInitialAuthSessionRefresh({
  refresh: async () => {
    initialAttempts += 1;
    if (initialAttempts < 3) throw new AuthSessionUnavailableError(503);
    return previewSession;
  },
  getToken,
  schedule: (callback, delayMs) => {
    const job = { callback, delayMs, id: ++nextRetryId };
    scheduledRetries.push(job);
    return job.id;
  },
  cancel: timer => { cancelledRetries.push(timer); },
  onSuccess: session => { initialResults.push(session as typeof previewSession | null); },
  onRetry: (_error, delayMs) => { retryDelays.push(delayMs); },
  onFailure: error => { initialFailures.push(error); },
});
await flush();
assert.equal(initialAttempts, 1);
assert.deepEqual(retryDelays, [500]);
assert.deepEqual(initialResults, [], 'the UI must remain loading while the supervised backend starts');
scheduledRetries.shift()!.callback();
await flush();
assert.deepEqual(retryDelays, [500, 1_000]);
scheduledRetries.shift()!.callback();
await flush();
assert.equal(initialAttempts, 3);
assert.deepEqual(initialResults, [previewSession]);
assert.deepEqual(initialFailures, []);
stopInitialRefresh();
assert.deepEqual(cancelledRetries, [2]);

setToken('retained-session-token');
let retainedFailure: unknown;
let retainedSchedules = 0;
startInitialAuthSessionRefresh({
  refresh: async () => { throw new AuthSessionUnavailableError(503); },
  getToken,
  schedule: () => { retainedSchedules += 1; return retainedSchedules; },
  cancel: () => {},
  onSuccess: () => { throw new Error('unexpected success'); },
  onFailure: error => { retainedFailure = error; },
});
await flush();
assert.ok(retainedFailure instanceof AuthSessionUnavailableError);
assert.equal(retainedSchedules, 0, 'an existing unavailable session must use the retained-session UI instead of bootstrap retries');

console.log('auth session refresh failure semantics passed');
