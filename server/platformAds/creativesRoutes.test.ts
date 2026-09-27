import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-creative-routes-'));
process.env.LOCAL_STORE_DIR = temp;
process.env.PB_URL = 'http://127.0.0.1:1';
process.env.NODE_ENV = 'test';
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
process.env.TEST_ONLY_EXTERNAL_EFFECT_LEASE_FALLBACK = 'true';
const { platformAdCreativesRouter } = await import('../routes/platformAdCreatives.js');
const { issueLocalIdentityTokenForTest } = await import('../auth/localIdentity.js');
const { store } = await import('../storage/index.js');
const app = express(); app.use(express.json()); app.use('/ads', platformAdCreativesRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/ads`;
const auth = (role = 'admin') => ({ Authorization: `Bearer ${issueLocalIdentityTokenForTest({ userId: 'test-user', tenantId: 'tenant-a', role })}`, 'Content-Type': 'application/json' });
try {
  assert.equal((await fetch(base + '/creative-sources')).status, 401);
  assert.equal((await fetch(base + '/creative-sources', { headers: auth() })).status, 200);
  assert.equal((await fetch(base + '/tasks/missing/creatives', { headers: auth() })).status, 404);
  for (const route of ['/tasks/missing/creatives', '/tasks/missing/creatives/missing/upload', '/tasks/missing/creatives/missing/reconcile']) {
    assert.equal((await fetch(base + route, { method: 'POST', headers: auth('customer_service'), body: '{}' })).status, 403);
  }
  await store.create('platform_ad_tasks', { id: 'foreign-task', tenant_id: 'tenant-b', name: 'private' });
  await store.create('platform_ad_creatives', { id: 'foreign-creative', tenant_id: 'tenant-b', taskId: 'foreign-task', fileRef: 'private-reference' });
  for (const action of ['upload', 'reconcile']) {
    const response = await fetch(base + `/tasks/foreign-task/creatives/foreign-creative/${action}`, { method: 'POST', headers: auth(), body: '{}' });
    assert.equal(response.status, 404, 'foreign creative upload/reconcile must not disclose or mutate another tenant');
    assert.ok(!(await response.text()).includes('private-reference'));
  }
  const previous = store.list;
  store.list = async () => { throw new Error('secret_internal_storage_key'); };
  try {
    const failed = await fetch(base + '/creative-sources', { headers: auth() });
    assert.equal(failed.status, 503);
    assert.ok(!(await failed.text()).includes('secret_internal_storage_key'));
  } finally { store.list = previous; }
  console.log('Creative routes authentication, mutation role boundary and diagnostic redaction tests passed');
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(temp, { recursive: true, force: true });
}
