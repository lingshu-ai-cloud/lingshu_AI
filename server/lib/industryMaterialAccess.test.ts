import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore } from '../storage/datastore.js';
import { readMaterialLibrary } from './materialLibrary.js';
import { readCloudMaterialLibrary } from './cloudMaterials.js';
import { officialIndustryMaterialVisible, readMaterialTenantIndustry, tenantUploadUsesReservedOrigin } from './industryMaterialAccess.js';

const shared = { id: 'official-beauty', scope: 'shared', industry: 'beauty_skincare', sourceCategory: 'official_import', title: '行业素材', type: 'image' };
const profiles: Record<string, string> = { 'beauty-a': '美妆护肤', 'beauty-b': 'beauty_skincare', apparel: '服装' };
const materials = [shared, { ...shared, id: 'official-apparel', industry: 'apparel_textile' },
  { ...shared, id: 'unclassified', industry: '' }, { id: 'private-a', scope: 'own', tenantId: 'beauty-a', title: 'A 私有', type: 'image' }];
const dataStore = { list: async (collection: string, query: { where?: { tenant_id?: string } }) => {
  const tenant = query.where?.tenant_id || '';
  const items = collection === 'materials' ? materials : profiles[tenant]
    ? [{ id: tenant, tenant_id: tenant, profile: { company: { industry: profiles[tenant] } } }] : [];
  return { items, totalItems: items.length, totalPages: 1, page: 1, perPage: 500 };
} } as unknown as DataStore;

test('official industry assets are shared by same-industry accounts while own assets stay private', async () => {
  const a = await readCloudMaterialLibrary('beauty-a', undefined, dataStore);
  const b = await readCloudMaterialLibrary('beauty-b', undefined, dataStore);
  const apparel = await readCloudMaterialLibrary('apparel', undefined, dataStore);
  assert.deepEqual(a.items.map(row => row.id), ['pb-official-beauty', 'pb-private-a']);
  assert.deepEqual(b.items.map(row => row.id), ['pb-official-beauty']);
  assert.deepEqual(apparel.items.map(row => row.id), ['pb-official-apparel']);
  assert.deepEqual((await readCloudMaterialLibrary('no-profile', undefined, dataStore)).items, []);
});

test('missing or non-official shared industry metadata does not grant library access', () => {
  assert.equal(officialIndustryMaterialVisible(shared, 'beauty_skincare'), true);
  assert.equal(officialIndustryMaterialVisible({ ...shared, sourceCategory: 'user_generated' }, 'beauty_skincare'), false);
  assert.equal(officialIndustryMaterialVisible({ ...shared, industry: '' }, 'beauty_skincare'), false);
  assert.equal(officialIndustryMaterialVisible(shared, ''), false);
});

test('industry comes from the exact tenant profile and never from user query parameters', async () => {
  assert.equal(await readMaterialTenantIndustry('beauty-b', dataStore), 'beauty_skincare');
  assert.equal(await readMaterialTenantIndustry('missing', dataStore), '');
});

test('ordinary upload origin cannot impersonate official shared or in-system generated materials', () => {
  for (const input of [{ scope: 'shared' }, { folder: 'hot' }, { sourceType: 'official-import' },
    { sourceType: 'generation' }, { sourceCategory: 'official_import' }, { sourceCategory: 'user_generated' }, { sourceType: 'ai_generated_marketing_image' }]) {
    assert.equal(tenantUploadUsesReservedOrigin(input), true);
  }
  assert.equal(tenantUploadUsesReservedOrigin({ sourceType: 'local-upload', productId: 'p' }), false);
  assert.equal(tenantUploadUsesReservedOrigin({ sourceType: 'product-scene-preparation' }), false);
});


test('local official inventory follows the same industry-sharing rule as the database', async () => {
  const adapters = { local: () => materials, dataStore,
    cloud: async () => ({ items: [], source: { source: 'database' as const, state: 'ready' as const, message: 'test' } }) };
  const beauty = await readMaterialLibrary('beauty-b', adapters);
  const apparel = await readMaterialLibrary('apparel', adapters);
  assert.deepEqual(beauty.items.map(item => item.id), ['official-beauty']);
  assert.deepEqual(apparel.items.map(item => item.id), ['official-apparel']);
});
