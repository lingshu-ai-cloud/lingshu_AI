import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';

process.env.SUBSCRIPTION_ENFORCED = 'false';
process.env.DEMO_MODE = 'false';
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
process.env.DISABLE_LOCAL_AUTH_FALLBACK = 'false';

const { auth, store } = await import('../storage/index.js');
const { bindDataAuthority, dataAuthorityRequestScope } = await import('../storage/dataAuthority.js');
auth.verifyToken = async () => {
  bindDataAuthority('local');
  return { userId: 'studio-cas-test-user', tenantId: 'local_tenant_studio_cas', dataAuthority: 'local' };
};

const { studioRouter } = await import('./studio.js');

test('Studio save returns the latest project instead of overwriting a production write inserted before CAS', async () => {
  const app = express();
  app.use(dataAuthorityRequestScope);
  app.use(express.json());
  app.use('/studio', studioRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/studio/projects`;
  const headers = { 'content-type': 'application/json', authorization: 'Bearer studio-cas-test' };
  const originalCompareAndSwap = store.compareAndSwap!.bind(store);
  let projectId = '';

  try {
    const createdResponse = await fetch(baseUrl, {
      method: 'POST', headers,
      body: JSON.stringify({ title: 'CAS draft', status: 'draft', spec: { script: 'server baseline' } }),
    });
    const created = await createdResponse.json() as { project: { id: string; updatedAt: string } };
    assert.equal(createdResponse.status, 201);
    projectId = created.project.id;

    let injected = false;
    store.compareAndSwap = async (collection, id, expected, patch) => {
      if (!injected && collection === 'studio_projects' && id === projectId) {
        injected = true;
        const current = await store.getById<any>('studio_projects', projectId);
        assert.ok(current);
        const productionUpdatedAt = new Date(Date.parse(created.project.updatedAt) + 1_000).toISOString();
        assert.equal(await store.update('studio_projects', projectId, {
          spec: { ...current.spec, productionReceipt: { materialId: 'finished-clip' } },
          updated_at: productionUpdatedAt,
        }), true);
      }
      return originalCompareAndSwap(collection, id, expected, patch);
    };

    const saveResponse = await fetch(baseUrl, {
      method: 'POST', headers,
      body: JSON.stringify({
        id: projectId,
        title: 'CAS draft',
        status: 'draft',
        baseUpdatedAt: created.project.updatedAt,
        spec: { script: 'local stale edit' },
      }),
    });
    const conflict = await saveResponse.json() as { code?: string; project?: { spec?: Record<string, any> } };
    assert.equal(saveResponse.status, 409, JSON.stringify(conflict));
    assert.equal(conflict.code, 'studio_project_version_conflict');
    assert.equal(conflict.project?.spec?.productionReceipt?.materialId, 'finished-clip');
    assert.equal(conflict.project?.spec?.script, 'server baseline');

    const stored = await store.getById<any>('studio_projects', projectId);
    assert.equal(stored.spec.productionReceipt.materialId, 'finished-clip');
    assert.equal(stored.spec.script, 'server baseline');
  } finally {
    store.compareAndSwap = originalCompareAndSwap;
    if (projectId) await store.delete('studio_projects', projectId);
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
