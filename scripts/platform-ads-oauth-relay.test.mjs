import assert from 'node:assert/strict';
import { createAdCallbackRelay, callbackPath } from './platform-ads-oauth-relay.mjs';
const calls = [];
const transport = async (url, init) => { calls.push({ url: String(url), init }); return new Response('private upstream content'); };
async function fixture(enabled, run) {
  const server = createAdCallbackRelay({ enabled, transport });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const state = 'a'.repeat(43), params = `?state=${state}&code=isolated-test-code`;
await fixture(false, async base => {
  assert.equal((await fetch(base + callbackPath + params)).status, 503);
  assert.equal((await fetch(base + '/')).status, 404);
  assert.equal(calls.length, 0, 'disabled relay cannot reach the business service');
});
await fixture(true, async base => {
  for (const path of ['/', '/api/overseas/platform-ads/connections', '/api/overseas/auth/login', '/media/test.mp4', '/api/collections', callbackPath + '/', '/api/overseas/platform-ads/oauth/meta/%63allback']) assert.equal((await fetch(base + path)).status, 404);
  assert.equal((await fetch(base + callbackPath + params, { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + callbackPath + params, { method: 'HEAD' })).status, 405);
  for (const query of ['?state=bad&code=test', params + '&state=duplicate', params + '&next=https://evil.invalid', params + '&error=access_denied', '?state=' + state, params + '&code=duplicate']) assert.equal((await fetch(base + callbackPath + query)).status, 400);
  assert.equal(calls.length, 0);
  const ok = await fetch(base + callbackPath + params, { headers: { Cookie: 'private-cookie', Authorization: 'Bearer private-token', 'X-Forwarded-Host': 'evil.invalid' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.equal(ok.headers.get('referrer-policy'), 'no-referrer');
  assert.ok(!(await ok.text()).includes('private'));
  assert.equal(new URL(calls[0].url).origin, 'http://127.0.0.1:8890');
  assert.equal(new URL(calls[0].url).pathname, callbackPath);
  assert.deepEqual(calls[0].init.headers, { Accept: 'text/plain' });
  assert.equal(calls[0].init.redirect, 'error');
  const cancel = await fetch(base + callbackPath + `?state=${state}&error=access_denied&error_description=private-description`);
  assert.equal(cancel.status, 200);
  assert.ok(!calls.at(-1).url.includes('private-description'));
});
console.log('Callback relay default-deny, exact path, GET-only, query validation and credential isolation passed (mock upstream only).');
for (const upstreamPort of [0, 65536, -1, 8990.1, '8990']) assert.throws(() => createAdCallbackRelay({ upstreamPort }), /port/);
const currentPreview = createAdCallbackRelay({ enabled: true, upstreamPort: 8990, transport });
await new Promise(resolve => currentPreview.listen(0, '127.0.0.1', resolve));
try {
  const base = `http://127.0.0.1:${currentPreview.address().port}`;
  assert.equal((await fetch(base + callbackPath + params)).status, 200);
  assert.equal(new URL(calls.at(-1).url).origin, 'http://127.0.0.1:8990');
  assert.equal(new URL(calls.at(-1).url).pathname, callbackPath);
  assert.equal((await fetch(base + '/api/overseas/auth/login')).status, 404);
} finally { await new Promise(resolve => currentPreview.close(resolve)); }
console.log('Current preview port is supported without exposing arbitrary hosts or API paths.');
