import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { readFileSync } from 'node:fs';
import type { DataStore } from '../storage/datastore.js';
import { createStudioProjectReadRouter, projectFromRecord } from './studioProjectReadRoutes.js';

const studioRouteSource = readFileSync(new URL('./studio.ts', import.meta.url), 'utf8');
const projectReadMount = studioRouteSource.indexOf('application.projectRoutesApplication.registerStudioProjectReadRouter()');
assert.ok(projectReadMount > studioRouteSource.indexOf('studioRouter.use(requireAuth)'), 'project reads must remain under Studio authentication');
assert.ok(projectReadMount > studioRouteSource.indexOf('studioTenantContext.run((res.locals as AuthLocals).tenantId, next)'), 'project reads must inherit tenant context');

test('project read routes keep tenant and social-task scope with honest evidence', async () => {
  const project = {
    id: 'project-a', tenant_id: 'tenant-a', title: 'A', status: 'draft',
    spec: { socialContentTaskId: 'task-a', voiceoverUrl: '/api/overseas/studio/private-assets/tts/voice.wav' },
    created_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-21T00:00:00Z',
  };
  const otherTask = { ...project, id: 'project-other-task', spec: { socialContentTaskId: 'task-b' } };
  const otherTenant = { ...project, id: 'project-other-tenant', tenant_id: 'tenant-b' };
  const reads: Array<{ collection: string; tenantId: unknown }> = [];
  const dataStore = {
    list: async (collection: string, query: { where?: Record<string, unknown> }) => {
      reads.push({ collection, tenantId: query.where?.tenant_id });
      return { items: collection === 'studio_projects' ? [project, otherTask] : [], totalPages: 1, totalItems: 2 };
    },
    getById: async (_collection: string, id: string) => id === project.id ? project : id === otherTask.id ? otherTask : id === otherTenant.id ? otherTenant : null,
  } as unknown as DataStore;
  const projected = projectFromRecord(project, 'tenant-a');
  assert.equal(projected.spec._baseUpdatedAt, project.updated_at);
  assert.match(String(projected.spec.voiceoverUrl), /assetToken=/);
  assert.equal(project.spec.voiceoverUrl, '/api/overseas/studio/private-assets/tts/voice.wav', 'read projection must not mutate stored spec');

  const app = express();
  app.use((_req, res, next) => {
    res.locals.tenantId = 'tenant-a';
    res.locals.starter198SocialContext = { taskId: 'task-a' };
    next();
  });
  app.use('/projects', createStudioProjectReadRouter(() => [], dataStore));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/projects`;
  try {
    const list = await fetch(base);
    assert.equal(list.status, 200);
    assert.deepEqual((await list.json() as Array<{ id: string }>).map(item => item.id), ['project-a']);
    assert.deepEqual(reads, [{ collection: 'studio_projects', tenantId: 'tenant-a' }]);

    const own = await fetch(`${base}/project-a`);
    assert.equal(own.status, 200);
    assert.equal((await own.json() as { id: string }).id, 'project-a');
    assert.equal((await fetch(`${base}/project-other-task`)).status, 404);
    assert.equal((await fetch(`${base}/project-other-tenant`)).status, 404);

    const evidence = await fetch(`${base}/project-a/evidence`);
    assert.equal(evidence.status, 200);
    assert.equal(evidence.headers.get('cache-control'), 'private, no-store');
    const body = await evidence.json() as { status: string; gaps: Array<{ code: string }> };
    assert.equal(body.status, 'needs_review');
    assert.equal(body.gaps[0]?.code, 'no_storyboard');
    assert.equal((await fetch(`${base}/project-other-tenant/evidence`)).status, 404);

    const handoffs = await fetch(`${base}/project-a/manual-handoffs`);
    assert.equal(handoffs.status, 200);
    assert.equal(handoffs.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual((await handoffs.json() as { handoffs: unknown[] }).handoffs, []);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
