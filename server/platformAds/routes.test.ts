import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp = await mkdtemp(path.join(os.tmpdir(), 'ads-routes-'));
process.env.LOCAL_STORE_DIR = temp;
process.env.PB_URL = 'http://127.0.0.1:1';
process.env.NODE_ENV = 'test';
process.env.META_ADS_API_VERSION = 'v25.0';
const { platformAdsRouter } = await import('../routes/platformAds.js');
const { platformAdConnectionsRouter } = await import('../routes/platformAdConnections.js');
const { platformAdExecutionRouter } = await import('../routes/platformAdExecution.js');
const { platformAdMetricsRouter } = await import('../routes/platformAdMetrics.js');
const app = express(); app.use(express.json());
app.use('/ads', platformAdConnectionsRouter, platformAdsRouter, platformAdExecutionRouter, platformAdMetricsRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address() as { port: number };
const base = `http://127.0.0.1:${address.port}/ads`;
const token = (tenantId: string, role: string) => 'Bearer local-demo.' + Buffer.from(JSON.stringify({ userId: 'route-test-user', tenantId, role })).toString('base64url');
const request = (url: string, tenant = 'tenant-a', role = 'admin', body?: unknown) => fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: token(tenant, role), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
try {
  const callback = await fetch(base + '/oauth/meta/callback');
  assert.notEqual(callback.status, 401, 'OAuth callback must not be intercepted by app auth');
  const input = { name: 'HTTP测试', video: 'video', goal: '提升有效视频观看', market: 'US', budget: 100, channels: ['Facebook'] };
  assert.equal((await request('/tasks', 'tenant-a', 'customer_service', input)).status, 403);
  assert.equal((await request('/connections', 'tenant-a', 'customer_service', {})).status, 403);
  const created = await request('/tasks', 'tenant-a', 'admin', input);
  assert.equal(created.status, 201);
  const { task } = await created.json() as any;
  const metricResponse = await request(`/tasks/${task.id}/metrics`);
  assert.equal(metricResponse.status, 200, 'unexecuted drafts have a normal metrics empty state');
  const metrics = await metricResponse.json() as any;
  assert.equal(metrics.status, 'not_ready');
  assert.equal(metrics.source, 'none');
  assert.equal(metrics.currency, task.currency);
  assert.equal(metrics.reportedAt, '');
  for (const field of ['spend', 'impressions', 'clicks', 'results', 'costPerResult']) assert.equal(metrics[field], null, `${field} must not imply provider-reported zero`);
  assert.equal(metrics.forecast.status, 'insufficient_data');
  assert.ok(metrics.reason && metrics.dataNote);
  assert.equal((await request(`/tasks/${task.id}/metrics`, 'tenant-b')).status, 404);
  assert.equal((await request(`/tasks/${task.id}`, 'tenant-b')).status, 404);
  const denied = await request(`/tasks/${task.id}/execute`, 'tenant-a', 'customer_service', {});
  assert.equal(denied.status, 403);
  const managed = await request(`/tasks/${task.id}/management`, 'tenant-a', 'admin', { expectedVersion: task.version, managementMode: 'suggest' });
  assert.equal(managed.status, 200);
  const conflict = await request(`/tasks/${task.id}/management`, 'tenant-a', 'admin', { expectedVersion: task.version, managementMode: 'manual' });
  assert.equal(conflict.status, 409);
  for (const suffix of ['automation', 'approvals', 'launch']) assert.equal((await request(`/tasks/${task.id}/${suffix}`, 'tenant-b')).status, 404);
  const { store } = await import('../storage/index.js');
  const originalList = store.list, originalGet = store.getById;
  store.list = async () => { throw new Error('private storage diagnostic'); };
  store.getById = async () => { throw new Error('private storage diagnostic'); };
  try {
    for (const route of ['/tasks', `/tasks/${task.id}`, ...['automation', 'approvals', 'launch'].map(suffix => `/tasks/${task.id}/${suffix}`)]) {
      const failed = await request(route);
      assert.equal(failed.status, 503);
      assert.ok(!(await failed.text()).includes('private storage diagnostic'));
    }
  } finally { store.list = originalList; store.getById = originalGet; }
  console.log('ad HTTP auth, role, tenancy, OAuth routing and version tests passed');
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await rm(temp, { recursive: true, force: true });
}
