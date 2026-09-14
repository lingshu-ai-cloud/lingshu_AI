import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  OAUTH_CONFIG_FILE: process.env.OAUTH_CONFIG_FILE,
  PB_URL: process.env.PB_URL,
  DISABLE_LOCAL_AUTH_FALLBACK: process.env.DISABLE_LOCAL_AUTH_FALLBACK,
  LOCAL_ADMIN_EMAIL: process.env.LOCAL_ADMIN_EMAIL,
  WORKBENCH_ADMIN_EMAIL: process.env.WORKBENCH_ADMIN_EMAIL,
  ADMIN_DASHBOARD_EMAILS: process.env.ADMIN_DASHBOARD_EMAILS,
};
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-oauth-config-'));
const configFile = path.join(temporaryDirectory, 'oauth-config.json');
const initialConfig = {
  youtubeOAuthClientId: 'youtube-id',
  youtubeOAuthClientSecret: 'youtube-secret',
  disabledPlatforms: [],
  advancedManualConnectEnabled: false,
};
fs.writeFileSync(configFile, JSON.stringify(initialConfig, null, 2), { mode: 0o600 });

process.env.NODE_ENV = 'test';
process.env.OAUTH_CONFIG_FILE = configFile;
process.env.PB_URL = 'http://127.0.0.1:1';
process.env.DISABLE_LOCAL_AUTH_FALLBACK = 'false';
process.env.LOCAL_ADMIN_EMAIL = 'oauth-admin@example.test';
process.env.WORKBENCH_ADMIN_EMAIL = '';
process.env.ADMIN_DASHBOARD_EMAILS = '';

const { OAuthConfigUnavailableError, readOAuthConfig, writeOAuthConfig } = await import('../lib/oauthConfig.js');
const beforeRead = fs.readFileSync(configFile);
const beforeReadMtime = fs.statSync(configFile).mtimeMs;
assert.equal(readOAuthConfig().youtubeOAuthClientId, 'youtube-id');
assert.deepEqual(fs.readFileSync(configFile), beforeRead, 'ordinary OAuth config reads must not rewrite secret storage');
assert.equal(fs.statSync(configFile).mtimeMs, beforeReadMtime);

await Promise.all([
  writeOAuthConfig({ metaSocialAppId: 'meta-id' }),
  writeOAuthConfig({ tiktokClientKey: 'tiktok-key' }),
]);
const afterConcurrent = readOAuthConfig();
assert.equal(afterConcurrent.metaSocialAppId, 'meta-id', 'serialized patching must preserve the first concurrent update');
assert.equal(afterConcurrent.tiktokClientKey, 'tiktok-key', 'serialized patching must preserve the second concurrent update');
assert.equal(afterConcurrent.youtubeOAuthClientSecret, 'youtube-secret', 'unrelated stored secrets must survive patching');
assert.equal(fs.statSync(configFile).mode & 0o777, 0o600, 'atomic OAuth config writes must remain owner-only');

for (const malformed of ['{ malformed', '[]', JSON.stringify({ disabledPlatforms: ['unknown'] })]) {
  fs.writeFileSync(configFile, malformed, { mode: 0o600 });
  const bytes = fs.readFileSync(configFile);
  const mtime = fs.statSync(configFile).mtimeMs;
  assert.throws(() => readOAuthConfig(), OAuthConfigUnavailableError);
  await assert.rejects(writeOAuthConfig({ metaSocialAppId: 'must-not-write' }), OAuthConfigUnavailableError);
  assert.deepEqual(fs.readFileSync(configFile), bytes, 'malformed/schema-invalid OAuth config must not be overwritten');
  assert.equal(fs.statSync(configFile).mtimeMs, mtime);
}

const validConfig = JSON.stringify(afterConcurrent, null, 2);
fs.writeFileSync(configFile, validConfig, { mode: 0o600 });
fs.chmodSync(configFile, 0o000);
assert.throws(() => readOAuthConfig(), OAuthConfigUnavailableError, 'permission failures must fail closed');
fs.chmodSync(configFile, 0o600);

fs.writeFileSync(configFile, '{ malformed route fixture', { mode: 0o600 });
const malformedBytes = fs.readFileSync(configFile);
const malformedMtime = fs.statSync(configFile).mtimeMs;
const [{ adminRouter }, { issueLocalIdentityTokenForTest }] = await Promise.all([
  import('../routes/admin.js'),
  import('../auth/localIdentity.js'),
]);
const app = express();
app.use(express.json());
app.use('/admin', adminRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('test server did not bind a TCP port');
const origin = `http://127.0.0.1:${address.port}`;
const adminToken = issueLocalIdentityTokenForTest({
  userId: 'local_user_admin_oauth_admin_example_test',
  tenantId: 'local_tenant_admin_oauth_admin_example_test',
  email: 'oauth-admin@example.test',
  accountType: 'admin',
});

async function request(pathname: string, init: RequestInit = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${adminToken}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  const body = await response.json() as { error?: string };
  return { status: response.status, body };
}

try {
  for (const [pathname, init] of [
    ['/admin/oauth-config', {}],
    ['/admin/oauth-config', { method: 'PUT', body: JSON.stringify({ metaSocialAppId: 'must-not-write' }) }],
    ['/admin/oauth-config/meta', { method: 'DELETE' }],
  ] as Array<[string, RequestInit]>) {
    const response = await request(pathname, init);
    assert.equal(response.status, 503, `${init.method || 'GET'} ${pathname} must expose a stable storage failure`);
    assert.equal(response.body.error, 'oauth_config_unavailable');
    assert.deepEqual(fs.readFileSync(configFile), malformedBytes);
    assert.equal(fs.statSync(configFile).mtimeMs, malformedMtime);
  }
  assert.deepEqual(fs.readdirSync(temporaryDirectory), ['oauth-config.json'], 'failed atomic writes must not leave temp files');
  console.log('OAuth config persistence security tests passed');
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
