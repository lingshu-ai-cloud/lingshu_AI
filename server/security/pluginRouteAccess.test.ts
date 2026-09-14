import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  PB_URL: process.env.PB_URL,
  DISABLE_LOCAL_AUTH_FALLBACK: process.env.DISABLE_LOCAL_AUTH_FALLBACK,
  LOCAL_ADMIN_EMAIL: process.env.LOCAL_ADMIN_EMAIL,
  WORKBENCH_ADMIN_EMAIL: process.env.WORKBENCH_ADMIN_EMAIL,
  ADMIN_DASHBOARD_EMAILS: process.env.ADMIN_DASHBOARD_EMAILS,
  PLUGINS_DATA_FILE: process.env.PLUGINS_DATA_FILE,
};
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-plugin-access-'));
const pluginsFile = path.join(temporaryDirectory, 'plugins.json');
const storedSecret = 'stored-plugin-secret-must-not-leak';
const replacementSecret = 'replacement-plugin-secret-must-not-leak';
fs.writeFileSync(pluginsFile, JSON.stringify([{
  id: 'shopify',
  pluginKey: 'shopify',
  name: 'Shopify',
  nameZh: 'Shopify 店铺',
  category: 'ecommerce',
  description: 'Shopify fixture',
  icon: 'shop',
  status: 'installed',
  config: { storeDomain: 'private-shop.example', accessToken: storedSecret },
  installedAt: '2026-09-12T00:00:00.000Z',
}], null, 2), { mode: 0o600 });

process.env.NODE_ENV = 'test';
process.env.PB_URL = 'http://127.0.0.1:1';
process.env.DISABLE_LOCAL_AUTH_FALLBACK = 'false';
process.env.LOCAL_ADMIN_EMAIL = 'plugin-admin@example.test';
process.env.WORKBENCH_ADMIN_EMAIL = '';
process.env.ADMIN_DASHBOARD_EMAILS = '';
process.env.PLUGINS_DATA_FILE = pluginsFile;

const { pluginsRouter } = await import('../routes/plugins.js');
const app = express();
app.use(express.json());
app.use('/plugins', pluginsRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('test server did not bind a TCP port');
const origin = `http://127.0.0.1:${address.port}`;

const localToken = (claims: Record<string, string>) => `local-demo.${Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')}`;
const tenantToken = localToken({
  userId: 'plugin-tenant-member',
  tenantId: 'plugin-customer-tenant',
  email: 'member@example.test',
  accountType: 'customer',
});
const adminToken = localToken({
  userId: 'local_user_admin_plugin_admin_example_test',
  tenantId: 'local_tenant_admin_plugin_admin_example_test',
  email: 'plugin-admin@example.test',
  accountType: 'admin',
});

async function request(pathname: string, token = '', init: RequestInit = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  return { status: response.status, text, body: text ? JSON.parse(text) as unknown : null };
}

try {
  assert.equal((await request('/plugins')).status, 401, 'the catalog must still reject anonymous callers');

  const tenantCatalog = await request('/plugins', tenantToken);
  assert.equal(tenantCatalog.status, 200, 'an authenticated customer tenant must be able to open the integration center');
  const tenantPlugins = tenantCatalog.body as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(tenantPlugins) && tenantPlugins.length > 0);
  assert.ok(tenantPlugins.every(plugin => plugin.managementAllowed === false && !('config' in plugin)));
  assert.ok(tenantPlugins.every(plugin => Array.isArray(plugin.configuredFields) && plugin.configuredFields.length === 0));
  assert.equal(tenantPlugins.find(plugin => plugin.pluginKey === 'exchangerate')?.tenantUsable, true);
  assert.equal(tenantPlugins.find(plugin => plugin.pluginKey === 'translate')?.tenantUsable, true);
  assert.equal(tenantPlugins.find(plugin => plugin.pluginKey === 'shopify')?.tenantUsable, false);
  assert.equal(tenantPlugins.find(plugin => plugin.pluginKey === 'exchangerate')?.installed, true, 'tenant utilities must appear ready to use');
  assert.equal(tenantPlugins.find(plugin => plugin.pluginKey === 'shopify')?.installed, false, 'global installation state must not masquerade as a tenant connection');
  assert.doesNotMatch(tenantCatalog.text, new RegExp(`${storedSecret}|private-shop\\.example`));

  const beforeDeniedManagement = fs.readFileSync(pluginsFile, 'utf8');
  for (const [pathname, init] of [
    ['/plugins/amazon/install', { method: 'POST' }],
    ['/plugins/shopify/config', { method: 'PUT', body: JSON.stringify({ accessToken: replacementSecret }) }],
    ['/plugins/shopify/test', { method: 'POST' }],
    ['/plugins/shopify', { method: 'DELETE' }],
  ] as Array<[string, RequestInit]>) {
    const denied = await request(pathname, tenantToken, init);
    assert.equal(denied.status, 403, `${pathname} must remain internal-admin only`);
    assert.equal((denied.body as Record<string, unknown>).error, 'admin_required');
    assert.doesNotMatch(denied.text, new RegExp(`${storedSecret}|${replacementSecret}`));
  }
  assert.equal(fs.readFileSync(pluginsFile, 'utf8'), beforeDeniedManagement, 'denied customer management must not mutate global plugin configuration');

  const tenantUtility = await request('/plugins/translate/run', tenantToken, {
    method: 'POST',
    body: '{}',
  });
  assert.equal(tenantUtility.status, 400, 'an authenticated tenant must reach validation for an allowed utility capability');

  const adminCatalog = await request('/plugins', adminToken);
  assert.equal(adminCatalog.status, 200);
  const adminPlugins = adminCatalog.body as Array<Record<string, unknown>>;
  const adminShopify = adminPlugins.find(plugin => plugin.pluginKey === 'shopify');
  assert.equal(adminShopify?.managementAllowed, true);
  assert.deepEqual(adminShopify?.configuredFields, ['storeDomain', 'accessToken']);
  assert.doesNotMatch(adminCatalog.text, new RegExp(`${storedSecret}|private-shop\\.example`));

  const configured = await request('/plugins/shopify/config', adminToken, {
    method: 'PUT',
    body: JSON.stringify({ accessToken: replacementSecret }),
  });
  assert.equal(configured.status, 200, 'an exact internal admin must retain global configuration management');
  assert.equal((configured.body as Record<string, unknown>).managementAllowed, true);
  assert.doesNotMatch(configured.text, new RegExp(`${storedSecret}|${replacementSecret}|private-shop\\.example`));
  assert.equal((await request('/plugins/missing/test', adminToken, { method: 'POST' })).status, 404, 'internal admins must reach test route validation');

  const [concurrentA, concurrentB] = await Promise.all([
    request('/plugins/shopify/config', adminToken, { method: 'PUT', body: JSON.stringify({ concurrentA: 'alpha' }) }),
    request('/plugins/shopify/config', adminToken, { method: 'PUT', body: JSON.stringify({ concurrentB: 'beta' }) }),
  ]);
  assert.equal(concurrentA.status, 200);
  assert.equal(concurrentB.status, 200);
  const concurrentStored = JSON.parse(fs.readFileSync(pluginsFile, 'utf8')) as Array<{ config: Record<string, string> }>;
  assert.equal(concurrentStored[0].config.concurrentA, 'alpha', 'serialized writes must preserve the first concurrent patch');
  assert.equal(concurrentStored[0].config.concurrentB, 'beta', 'serialized writes must preserve the second concurrent patch');
  assert.equal(fs.statSync(pluginsFile).mode & 0o777, 0o600, 'atomic replacement must keep the registry owner-only');

  fs.writeFileSync(pluginsFile, '{ malformed registry', { mode: 0o600 });
  const malformedBytes = fs.readFileSync(pluginsFile);
  const malformedMtime = fs.statSync(pluginsFile).mtimeMs;
  const tenantWithBrokenRegistry = await request('/plugins', tenantToken);
  assert.equal(tenantWithBrokenRegistry.status, 200, 'the safe tenant catalog must not depend on internal registry health');
  const malformedRead = await request('/plugins', adminToken);
  assert.equal(malformedRead.status, 503);
  assert.equal((malformedRead.body as Record<string, unknown>).error, 'plugin_registry_unavailable');
  const malformedWrite = await request('/plugins/shopify/config', adminToken, { method: 'PUT', body: JSON.stringify({ shouldNotPersist: 'x' }) });
  assert.equal(malformedWrite.status, 503);
  assert.equal((malformedWrite.body as Record<string, unknown>).error, 'plugin_registry_unavailable');
  assert.deepEqual(fs.readFileSync(pluginsFile), malformedBytes, 'malformed storage must never be replaced with a guessed empty registry');
  assert.equal(fs.statSync(pluginsFile).mtimeMs, malformedMtime, 'a rejected malformed write must not touch mtime');

  fs.writeFileSync(pluginsFile, JSON.stringify(concurrentStored, null, 2), { mode: 0o600 });
  fs.chmodSync(pluginsFile, 0o000);
  const deniedMtime = fs.statSync(pluginsFile).mtimeMs;
  const permissionDenied = await request('/plugins', adminToken);
  assert.equal(permissionDenied.status, 503, 'registry permission failures must fail closed');
  assert.equal((permissionDenied.body as Record<string, unknown>).error, 'plugin_registry_unavailable');
  assert.equal(fs.statSync(pluginsFile).mtimeMs, deniedMtime, 'a permission failure must not mutate the registry');
  fs.chmodSync(pluginsFile, 0o600);

  console.log('plugin route least-privilege tests passed');
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
