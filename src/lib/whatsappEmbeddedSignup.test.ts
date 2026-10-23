import test from 'node:test';
import assert from 'node:assert/strict';
import { getWhatsAppEmbeddedSignupConfig, prepareWhatsAppEmbeddedSignup, startWhatsAppEmbeddedSignup } from './whatsappEmbeddedSignup';

test('browser signup preserves click login, pairs code/session in either order and cleans up stale callbacks', async () => {
  const original = { window: globalThis.window, localStorage: globalThis.localStorage, fetch: globalThis.fetch };
  const events = new EventTarget(), exchanges: Record<string, unknown>[] = [];
  let token = 'tenant-a-login';
  const logins: Array<(value: { authResponse?: { code: string } }) => void> = [];
  const options: Record<string, unknown>[] = [];
  const config = { appId: '999', configId: '888', tenantId: 'a', graphVersion: 'v25.0', signupMode: 'standard',
    configured: true, storageReady: true, connected: false, account: null };
  Object.assign(globalThis, { localStorage: { getItem: () => token }, window: {
    location: { search: '' }, history: { state: null }, setTimeout, clearTimeout,
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    FB: { init() {}, login(callback: typeof logins[number], input: Record<string, unknown>) { logins.push(callback); options.push(input); } },
  } });
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path.endsWith('/config')) return new Response(JSON.stringify(config));
    if (path.endsWith('/session')) return new Response(JSON.stringify({ state: 'issued-state', tenantId: 'a', expiresAt: Date.now() + 600000 }));
    assert.ok(path.endsWith('/exchange'));
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer tenant-a-login');
    exchanges.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ ok: true }));
  };
  const finish = (origin = 'https://www.facebook.com') => events.dispatchEvent(new MessageEvent('message', { origin,
    data: JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { waba_id: '100', phone_number_id: '101' } }) }));
  try {
    const prepared = await prepareWhatsAppEmbeddedSignup(await getWhatsAppEmbeddedSignupConfig());
    assert.equal(logins.length, 0);
    const first = startWhatsAppEmbeddedSignup(prepared);
    assert.equal(logins.length, 1, 'SDK login happens synchronously on the continuation click');
    const extras = options[0]!.extras as Record<string, unknown>;
    assert.equal(extras.featureType, undefined, 'standard onboarding must not force coexistence');
    finish('https://attacker.example'); logins[0]!({ authResponse: { code: 'code-a' } });
    assert.equal(exchanges.length, 0);
    finish(); assert.equal((await first).ok, true);
    assert.equal(exchanges[0]!.state, 'issued-state');
    const secondPrepared = await prepareWhatsAppEmbeddedSignup({ ...prepared.config, signupMode: 'coexistence' });
    const second = startWhatsAppEmbeddedSignup(secondPrepared);
    logins[0]!({}); // A stale callback cannot cancel the new attempt.
    finish(); logins[1]!({ authResponse: { code: 'code-b' } });
    await second;
    assert.equal((options[1]!.extras as Record<string, unknown>).featureType, 'whatsapp_business_app_onboarding');
    assert.equal(exchanges.length, 2);
    token = 'tenant-b-login';
    await assert.rejects(startWhatsAppEmbeddedSignup(prepared), /失效/);
    assert.equal(logins.length, 2);
    token = 'tenant-a-login';
    const cancelled = startWhatsAppEmbeddedSignup(await prepareWhatsAppEmbeddedSignup(prepared.config));
    const rejected = assert.rejects(cancelled, /未完成/);
    events.dispatchEvent(new MessageEvent('message', { origin: 'https://www.facebook.com', data: JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL' }) }));
    await rejected; finish(); logins[2]!({ authResponse: { code: 'late-code' } });
    assert.equal(exchanges.length, 2);
  } finally { Object.assign(globalThis, original); }
});
