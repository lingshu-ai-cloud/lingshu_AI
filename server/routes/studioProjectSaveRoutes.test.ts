import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { readFileSync } from 'node:fs';
import type { DataStore } from '../storage/datastore.js';
import { createStudioProjectSaveRouter } from './studioProjectSaveRoutes.js';

const studioRouteSource = readFileSync(new URL('./studio.ts', import.meta.url), 'utf8');
const saveMount = studioRouteSource.indexOf("studioRouter.use('/projects', createStudioProjectSaveRouter({");
assert.ok(saveMount > studioRouteSource.indexOf('studioRouter.use(requireAuth)'), 'project saves must remain authenticated');
assert.ok(saveMount > studioRouteSource.indexOf('studioTenantContext.run((res.locals as AuthLocals).tenantId, next)'), 'project saves must inherit tenant context');

test('project save route keeps production contract, server ownership and revision gates', async () => {
  const existing = { id: 'draft-a', tenant_id: 'tenant-a', title: 'Draft', status: 'draft', spec: {}, updated_at: '2026-10-23T00:00:00Z' };
  let writes = 0;
  let allowCreate = false;
  const dataStore = {
    getById: async (_collection: string, id: string) => id === existing.id ? existing : null,
    create: async (_collection: string, data: Record<string, unknown>) => { writes++; return allowCreate ? { id: 'new-draft', ...data } : null; },
    compareAndSwap: async () => { writes++; return false; },
  } as unknown as DataStore;
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.tenantId = 'tenant-a';
    res.locals.starter198SocialContext = { taskId: '' };
    next();
  });
  app.use('/projects', createStudioProjectSaveRouter({
    dataStore,
    loadMaterials: () => [],
    kbAssignmentIssues: async () => [],
    appendCompletedPosterMaterialUsage: async input => input.spec,
    unpublishableGenerationReasons: () => [],
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const post = (body: unknown) => fetch(`http://127.0.0.1:${address.port}/projects`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    const conflict = await post({ spec: { script: 'current', storyboardAssignments: { S01: 'current' },
      analysisResults: { schemaVersion: 'studio-analysis.v1', storyboard: { script: 'old', assignments: { S01: 'old' } }, voiceover: {}, shots: {} } } });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json() as { code: string }).code, 'STUDIO_PRODUCTION_CONTRACT_CONFLICT');

    const frozen = await post({ spec: { resolvedStudioContract: { version: 1 } } });
    assert.equal(frozen.status, 403);
    assert.equal((await frozen.json() as { code: string }).code, 'studio_frozen_contract_server_owned');

    const stale = await post({ id: 'draft-a', spec: {} });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json() as { code: string }).code, 'studio_project_version_conflict');
    assert.equal(writes, 0);

    const raced = await post({ id: 'draft-a', baseUpdatedAt: existing.updated_at, spec: {} });
    assert.equal(raced.status, 409);
    assert.equal((await raced.json() as { code: string }).code, 'studio_project_version_conflict');
    assert.equal(writes, 1, 'CAS conflict must not fall back to unconditional update');

    allowCreate = true;
    const created = await post({ title: 'New draft', spec: {} });
    assert.equal(created.status, 201);
    assert.equal((await created.json() as { project: { id: string } }).project.id, 'new-draft');
    assert.equal(writes, 2);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
