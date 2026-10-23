import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type { DataStore } from '../storage/datastore.js';
import { createStudioProjectReviewRouter } from './studioProjectReviewRoutes.js';

test('project review writes retain tenant, task, quality and trusted-workspace gates', async () => {
  const projects: Record<string, any> = {
    own: { id: 'own', tenant_id: 'tenant-a', updated_at: 'v1', spec: { socialContentTaskId: 'task-a' } },
    foreign: { id: 'foreign', tenant_id: 'tenant-b', updated_at: 'v1', spec: {} },
    otherTask: { id: 'otherTask', tenant_id: 'tenant-a', updated_at: 'v1', spec: { socialContentTaskId: 'task-b' } },
    trusted: { id: 'trusted', tenant_id: 'tenant-a', updated_at: 'v1', spec: { socialContentTaskId: 'task-a', automation: { managedBy: 'social_content_output' } } },
  };
  const deleted: string[] = [];
  const dataStore = {
    getById: async (_collection: string, id: string) => projects[id] ?? null,
    list: async () => ({ items: [], totalPages: 1, totalItems: 0 }),
    delete: async (_collection: string, id: string) => { deleted.push(id); return true; },
  } as unknown as DataStore;
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.tenantId = 'tenant-a';
    res.locals.userId = 'user-a';
    res.locals.starter198SocialContext = { taskId: 'task-a' };
    next();
  });
  app.use('/projects', createStudioProjectReviewRouter(dataStore));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/projects`;
  const post = (id: string, suffix: string, body: unknown = {}) => fetch(`${base}/${id}/${suffix}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    assert.equal((await post('foreign', 'requality')).status, 404);
    assert.equal((await post('otherTask', 'requality')).status, 404);
    assert.equal((await post('own', 'requality')).status, 422);
    assert.equal((await post('trusted', 'requality')).status, 409);
    assert.equal((await post('own', 'manual-handoffs', { action: 'team_review' })).status, 409);
    assert.equal((await post('trusted', 'manual-handoffs', { action: 'team_review' })).status, 409);
    assert.equal((await fetch(`${base}/foreign`, { method: 'DELETE' })).status, 404);
    assert.equal((await fetch(`${base}/otherTask`, { method: 'DELETE' })).status, 404);
    assert.equal((await fetch(`${base}/trusted`, { method: 'DELETE' })).status, 409);
    assert.deepEqual(deleted, []);
    assert.equal((await fetch(`${base}/own`, { method: 'DELETE' })).status, 200);
    assert.deepEqual(deleted, ['own']);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
