import assert from 'node:assert/strict';
import test from 'node:test';
import { preserveUserMaterialTheme } from '../../../shared/materialTaxonomy';
import { parseMaterialLibraryEntry } from './inspirationMaterialLibrary';
import { projectProductMaterialView } from './inspirationMaterialGalleryProjection';
import type { MaterialGalleryFilterSnapshot } from './inspirationMaterialLibrary';
import type { ProductMaterialSummary } from './inspirationProductMaterialInventory';
import { studioApi } from '../../lib/studioApi';

const filters: MaterialGalleryFilterSnapshot = {
  query: '', assetTab: 'all', type: 'all', industry: 'all', shotFunction: 'all',
  applicability: 'all', orientation: 'all', source: 'all', theme: 'all', favorite: 'all', categories: [],
};

test('analysis preserves user theme while still saving new duration and analysis', () => {
  const changes = { primaryTheme: 'product', themeTags: ['product'], classificationSource: 'model', classificationStatus: 'completed', classificationEvidence: ['model'], duration: 8, segments: [{ start: 0, end: 8 }] };
  assert.deepEqual(preserveUserMaterialTheme({ classificationSource: 'user' }, changes), { duration: 8, segments: [{ start: 0, end: 8 }] });
  assert.equal(preserveUserMaterialTheme({ classificationSource: 'model' }, changes), changes);
  assert.equal(changes.primaryTheme, 'product');
});

test('common product scope survives reload and legacy empty parameter links', () => {
  assert.equal(parseMaterialLibraryEntry('?view=library&productScope=common').productScope, 'common');
  assert.equal(parseMaterialLibraryEntry('?view=library&productId=&productRef=').productScope, 'common');
  assert.equal(parseMaterialLibraryEntry('?view=library').productScope, undefined);
  assert.equal(parseMaterialLibraryEntry('?view=library&productId=p').productId, 'p');
});

test('group cover and drawer share type/theme/source/query filtering and matching scene slots', () => {
  const summary = {
    materials: [
      { id: 'photo', name: 'photo', type: 'image', primaryTheme: 'product', productId: 'p' },
      { id: 'video', name: 'video', type: 'video', primaryTheme: 'factory', productId: 'p' },
      { id: 'generated', name: 'generated', type: 'image', primaryTheme: 'product', productId: 'p', sourceType: 'ai_generated' },
    ],
    slots: [{ materialId: 'video' }, { materialId: 'photo' }, { materialId: '' }], loading: false, error: '',
  } as unknown as ProductMaterialSummary;
  const result = projectProductMaterialView(summary, { ...filters, query: '产品名称', type: 'image', theme: 'product', categories: ['product'] }, '产品名称');
  assert.deepEqual(result.materials.map(item => item.id), ['photo']);
  assert.deepEqual(result.slots.map(slot => slot.materialId), ['photo']);
  assert.equal(projectProductMaterialView(summary, filters, '产品名称').slots.length, 3);
  assert.equal(projectProductMaterialView(summary, { ...filters, query: '不存在' }, '产品名称').materials.length, 0);
});

test('product catalog distinguishes actual empty catalog from HTTP and network failures', async t => {
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  t.after(() => { if (storage) Object.defineProperty(globalThis, 'localStorage', storage); else Reflect.deleteProperty(globalThis, 'localStorage'); });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ items: [] }));
  assert.deepEqual(await studioApi.materialProducts(), { items: [] });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'unavailable' }, { status: 503 }));
  await assert.rejects(studioApi.materialProducts(), /无法读取/);
  t.mock.method(globalThis, 'fetch', async () => Response.json({}, { status: 401 }));
  await assert.rejects(studioApi.materialProducts(), /登录已失效/);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('network failed'); });
  await assert.rejects(studioApi.materialProducts(), /network failed/);
});
