import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('durable multi-product selection accepts only current tenant IDs and preserves cancellation provenance', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'social-product-selection-'));
  const envKeys = ['LOCAL_STORE_DIR', 'NODE_ENV', 'ENABLE_LOCAL_DEV_FALLBACK', 'PB_URL'];
  const previous = envKeys.map(key => process.env[key]);
  Object.assign(process.env, { LOCAL_STORE_DIR: dir, NODE_ENV: 'test', ENABLE_LOCAL_DEV_FALLBACK: 'true', PB_URL: 'http://127.0.0.1:1' });
  try {
    const [{ runWithDataAuthority }, { writeTenantProfile, normalizeProfile }, { assertSocialTaskProductSelection },
      { LangGraphTestStore }, { createStarter198Repository }, { createSocialContentTask }] = await Promise.all([
      import('../storage/dataAuthority'), import('../routes/enterpriseProfileStore'), import('./socialContentTaskQueries'),
      import('../../scripts/langgraphTestStore'), import('./repository'), import('./socialContentTasks'),
    ]);
    await runWithDataAuthority('local', async () => {
      const profile = normalizeProfile({ company: { name: 'A' }, products: { items: [{ id: 'a-1', name: '同名' }, { id: 'a-2', name: '同名' }] } } as never);
      await writeTenantProfile('tenant-a', profile, 'user-a');
      await writeTenantProfile('tenant-b', normalizeProfile({ products: { items: [{ id: 'b-1', name: '同名' }] } } as never), 'user-b');
      const productMaterialSelection = { productIds: ['a-1', 'a-2'], selectedIds: ['material-2'], automaticIds: ['material-2'],
        dismissedIds: ['material-1'], preservedProductIds: [], candidateProductIds: { 'material-1': 'a-1', 'material-2': 'a-2' } };
      const selection = { productId: 'a-1', productIds: ['a-1', 'a-2'], productMaterialSelection };
      await assertSocialTaskProductSelection('tenant-a', selection);
      await assert.rejects(assertSocialTaskProductSelection('tenant-b', selection), /social_content_product_not_found/);
      await assert.rejects(assertSocialTaskProductSelection('tenant-a', { ...selection, productIds: ['a-1', 'b-1'] }), /social_content_product_not_found/);
      const store = new LangGraphTestStore(path.join(dir, 'tasks.json'));
      await store.create('tenant_profiles', { tenant_id: 'tenant-a', profile });
      const repository = createStarter198Repository(store, { materialLibrary: async () => ({ items: [], totalItems: 0 }) as never });
      const task = await createSocialContentTask({ repository, tenantId: 'tenant-a', userId: 'user-a', idempotencyKey: 'multi-product-selection',
        value: { title: '两个同名产品', objective: '保留稳定身份', ...selection, assetAvailability: 'none' } });
      assert.deepEqual(task.brief.productIds, selection.productIds);
      assert.deepEqual(task.brief.productMaterialSelection, productMaterialSelection);
      assert.equal(task.brief.assetAvailability, 'none'); assert.equal(task.runId, null);
    });
  } finally {
    envKeys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    await rm(dir, { recursive: true, force: true });
  }
});
