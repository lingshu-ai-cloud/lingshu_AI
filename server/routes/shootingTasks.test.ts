import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { DataStore } from '../storage/datastore.js';
import { createShootingTasksRouter } from './shootingTasks.js';

test('shooting API: tenant isolation, validation, durable reload, append and failure handling', async () => {
  const records = new Map<string, any>();
  let counter = 0;
  let failWrites = false;
  const store: DataStore = {
    async getById<T>(collection: string, id: string) { return structuredClone(records.get(`${collection}/${id}`) || null) as T | null; },
    async create<T>(collection: string, data: Record<string, unknown>) {
      if (failWrites) return null;
      const row = { ...data, id: `record-${++counter}` }; records.set(`${collection}/${row.id}`, structuredClone(row)); return row as T;
    },
    async update(collection, id, data) {
      if (failWrites || !records.has(`${collection}/${id}`)) return false;
      records.set(`${collection}/${id}`, { ...records.get(`${collection}/${id}`), ...structuredClone(data) }); return true;
    },
    async delete(collection, id) { return records.delete(`${collection}/${id}`); },
    async list<T>(collection: string, query = {}) {
      const where = (query as { where?: Record<string, unknown> }).where || {};
      const items = [...records.entries()].filter(([key, value]) => key.startsWith(`${collection}/`) && Object.entries(where).every(([field, expected]) => value[field] === expected)).map(([, value]) => structuredClone(value) as T);
      return { items, totalItems: items.length, totalPages: 1, page: 1, perPage: 200 };
    },
  };
  const requirement = 'immutable-v1';
  records.set('studio_projects/draft', { tenant_id: 'A', status: 'draft', spec: { activeAssemblyId: 'video-1', shootingSlots: [{ id: 'stable', requirements: requirement }] } });
  records.set('studio_projects/published', { tenant_id: 'A', status: 'published', spec: {} });
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { if (!req.headers['x-test-tenant']) { res.sendStatus(401); return; } res.locals.tenantId = req.headers['x-test-tenant']; next(); });
  app.use('/tasks', createShootingTasksRouter(store, async (id, tenant) => tenant === 'A' && ['video-1', 'video-2', 'video-3'].includes(id)));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/tasks`;
  const call = (path = '', body?: unknown, tenant = 'A') => fetch(url + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(tenant ? { 'x-test-tenant': tenant } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const input = { title: '补拍设备进料', shotBrief: '完整拍摄至少三秒', suggestedDurationSec: 3, sourceProjectId: 'draft', sourceAssemblyId: 'video-1', sourceShotId: 'stable', requirements: requirement };
  try {
    assert.equal((await call('', undefined, '')).status, 401);
    assert.equal((await call('', input, 'B')).status, 404);
    assert.equal((await call('', { ...input, sourceProjectId: 'published' })).status, 404);
    assert.equal((await call('', { ...input, requirements: 'old' })).status, 409);
    assert.equal((await call('', { ...input, sourceProjectId: undefined })).status, 400);
    assert.equal((await call('', { ...input, suggestedDurationSec: -1 })).status, 400);
    const created = await call('', input); assert.equal(created.status, 201);
    const task = await created.json(); assert.equal(task.origin, 'script_gap');
    assert.deepEqual(await (await call('', undefined, 'B')).json(), []);
    assert.equal((await call(`/${task.id}/uploads`, { uploadedMaterialIds: ['video-1'] }, 'B')).status, 404);
    assert.equal((await call(`/${task.id}/uploads`, { uploadedMaterialIds: ['other-tenant-video'] })).status, 400);
    assert.equal((await call(`/${task.id}/uploads`, { uploadedMaterialIds: ['image'] })).status, 400);
    const concurrent = await Promise.all(['video-1', 'video-2', 'video-1', 'video-3'].map(id => call(`/${task.id}/uploads`, { uploadedMaterialIds: [id] })));
    assert.ok(concurrent.every(response => response.status === 200));
    const tasks = await (await call()).json();
    assert.deepEqual([...tasks[0].uploadedMaterialIds].sort(), ['video-1', 'video-2', 'video-3']);
    assert.equal(tasks[0].requirements, requirement);
    assert.equal(tasks[0].sourceShotId, 'stable');
    failWrites = true;
    assert.equal((await call('', input)).status, 503);
    assert.equal((await call(`/${task.id}/uploads`, { uploadedMaterialIds: ['video-1'] })).status, 503);
    assert.deepEqual([...(await (await call()).json())[0].uploadedMaterialIds].sort(), ['video-1', 'video-2', 'video-3']);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
