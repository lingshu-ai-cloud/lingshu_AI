import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { prepared } from './socialContentSceneReworkService.fixture.js';
import { createStarter198Repository } from './repository.js';
import { createSocialSceneReworkRouter } from './socialContentSceneReworkRouter.js';

test('HTTP reads actual scoped failures and rejects actor overrides, stale shape and unregistered execution without creating jobs', async () => {
  const f = await prepared();
  await f.service.saveCache(f.context);
  const app = express();
  app.use(express.json());
  app.use('/tasks/:taskId/scene-rework', createSocialSceneReworkRouter({ repository: f.repository,
    authorize: async req => ({ tenantId: String(req.headers['x-test-tenant'] ?? 't'), userId: 'owner' }),
    assertWorkerRegistered: async () => { throw new Error('scene_rework_worker_not_registered'); },
    wake: async () => { throw new Error('must not wake'); } }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/tasks/content/scene-rework`;
  try {
    const response = await fetch(`${url}?parentArtifactId=artifact`);
    assert.equal(response.status, 200);
    const { item } = await response.json() as any;
    assert.equal(item.tenantId, 't');
    assert.equal(item.scenes[1].status, 'failed');
    assert.equal(item.scenes[1].technicalReceiptId, f.context.cache.scenes[1]!.technicalReceiptId);
    assert.ok(item.scenes[1].checks.some((check: any) => !check.passed));
    assert.equal(JSON.stringify(item).includes(f.local), false);
    const submit = (body: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const body = { parentArtifactId: 'artifact', affectedSceneIds: ['scene-cta'], expectedCacheHash: item.cacheHash };
    for (const invalid of [{ ...body, actorUserId: 'fake' }, { ...body, affectedSceneIds: ['scene-cta', 'scene-cta'] },
      { parentArtifactId: 'artifact', affectedSceneIds: ['scene-cta'] }]) {
      assert.equal((await submit(invalid)).status, 409);
    }
    const blocked = await submit({ ...body, expectedPreviewHash: 'a'.repeat(64) });
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json() as any).error, 'scene_rework_worker_not_registered');
    assert.equal(f.tables.content_execution_jobs?.length ?? 0, 0);
    assert.ok((await fetch(`${url}?parentArtifactId=artifact`, { headers: { 'x-test-tenant': 'foreign' } })).status >= 400);
  } finally { server.close(); await once(server, 'close'); await f.cleanup(); }
});
