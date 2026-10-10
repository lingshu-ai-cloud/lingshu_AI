import assert from 'node:assert/strict';
import { test } from 'node:test';
import { store } from '../storage/index.js';
import type { ListQuery } from '../storage/datastore.js';
import { readTenantEnterpriseProfileStrict } from '../routes/enterprise.js';

test('assistant enterprise reader never substitutes demo or another tenant, and preserves AI opt-out', async () => {
  const originalList = store.list;
  let items: Record<string, unknown>[] = [];
  store.list = async <T>(collection: string, query?: ListQuery) => {
    assert.equal(collection, 'tenant_profiles');
    assert.deepEqual(query?.where, { tenant_id: 'tenant-a' });
    assert.equal(query?.perPage, 1);
    return { items: items as T[], totalItems: items.length, totalPages: 1, page: 1, perPage: 1 };
  };
  try {
    assert.equal(await readTenantEnterpriseProfileStrict('tenant-a'), null);
    items = [{ id: 'foreign', tenant_id: 'tenant-b', profile: { company: { name: 'OTHER TENANT' } } }];
    await assert.rejects(readTenantEnterpriseProfileStrict('tenant-a'), /tenant_mismatch/);
    items = [{ id: 'bad', tenant_id: 'tenant-a', profile: 'invalid json' }];
    assert.equal(await readTenantEnterpriseProfileStrict('tenant-a'), null);
    items = [{ id: 'ours', tenant_id: 'tenant-a', profile: JSON.stringify({ company: { name: 'OUR TENANT' }, dataGovernance: { aiAccessEnabled: false } }) }];
    const profile = await readTenantEnterpriseProfileStrict('tenant-a');
    assert.equal(profile?.company.name, 'OUR TENANT');
    assert.equal(profile?.dataGovernance?.aiAccessEnabled, false);
  } finally { store.list = originalList; }
});
