/** Run only against tests/isolated-studio-server.ts; makes no paid calls. */
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:8793';
const health = await fetch(`${base}/api/overseas/health`).then(r => r.json());
assert.equal(health.isolated, true);
assert.equal(health.backgroundJobs, false);
const login = await fetch(`${base}/api/overseas/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'studio-test@example.invalid', password: 'Local-Acceptance-Only-2026' }),
});
assert.equal(login.status, 200);
const session = await login.json();
assert.ok(session.token);
const response = await fetch(`${base}/api/overseas/studio/materials`, { headers: { Authorization: `Bearer ${session.token}` } });
assert.equal(response.status, 200);
assert.equal(response.headers.get('X-Studio-Material-Warning'), 'cloud_unavailable');
assert.ok(Array.isArray(await response.json()));
assert.equal((await fetch(`${base}/api/overseas/health`)).status, 200, 'cloud failure must not terminate the server');
console.log('Isolated HTTP smoke passed: real auth, cloud-down degradation, local materials, server survives; no paid calls');
