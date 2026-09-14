import assert from 'node:assert/strict';
import { AuthSessionUnavailableError, getToken, refreshAuthSession, setToken } from './auth.js';

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

console.log('auth session refresh failure semantics passed');
