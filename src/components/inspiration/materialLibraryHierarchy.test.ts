import assert from 'node:assert/strict';
import test from 'node:test';
import { materialLibraryCategoryOf, materialMatchesLibraryCategory, materialMatchesLibrarySelection, normalizeMaterialLibrarySelection } from '../../../shared/materialLibraryKinds';
import { projectMaterialGallery } from './inspirationMaterialGalleryProjection';
import type { Material } from '../../lib/studioApi';
import type { MaterialGalleryFilterSnapshot } from './inspirationMaterialLibrary';

const assets = [
  { id: 'product', productId: 'p', sourceType: 'enterprise_product_table' },
  { id: 'enterprise', sourceType: 'local-upload' },
  { id: 'generated', sourceType: 'ai_generated_marketing_image', productId: 'p' },
  { id: 'official', scope: 'shared', sourceCategory: 'official_import', industry: 'beauty_skincare' },
].map(row => ({ ...row, name: row.id, type: 'image', scope: 'own', ...row })) as Material[];

test('internal product/enterprise/generated and external industry categories stay distinct', () => {
  assert.deepEqual(assets.map(materialLibraryCategoryOf), ['product', 'enterprise', 'generated', 'industry']);
  assert.equal(materialLibraryCategoryOf({ scope: 'own', sourceType: 'ai-storyboard-video' }), 'generated');
  assert.equal(materialLibraryCategoryOf({ scope: 'shared', sourceCategory: 'user_generated' }), null);
  assert.deepEqual(assets.filter(item => materialMatchesLibraryCategory(item, 'internal', 'generated')).map(item => item.id), ['generated']);
  assert.deepEqual(assets.filter(item => materialMatchesLibraryCategory(item, 'external', 'industry')).map(item => item.id), ['official']);
});

test('parent without a child always displays both internal and external assets as the user requested', () => {
  for (const group of ['all', 'internal', 'external'] as const) {
    assert.equal(assets.filter(item => materialMatchesLibraryCategory(item, group, 'all')).length, 4);
  }
  assert.equal(materialMatchesLibraryCategory(assets[3], 'internal', 'industry'), false);
});

test('secondary filters include product-associated generated assets without showing unrelated product groups', () => {
  const filters: MaterialGalleryFilterSnapshot = { group: 'external', category: 'industry',
    query: '', assetTab: 'all', type: 'all', industry: 'all', shotFunction: 'all', applicability: 'all',
    orientation: 'all', source: 'all', theme: 'all', favorite: 'all' };
  const input = { materials: assets, products: [{ id: 'p', name: '产品' }],
    summaries: { p: { materials: [assets[0], assets[2]], slots: [], loading: false, error: '' } },
    productFilter: { enabled: false, productId: '', productRef: '' }, page: 1, pageSize: 20 };
  const external = projectMaterialGallery({ ...input, filters });
  assert.equal(external.visibleMaterialTotal, 1);
  assert.equal(external.visibleProductGroups.length, 0);
  const generated = projectMaterialGallery({ ...input, filters: { ...filters, group: 'internal', category: 'generated' } });
  assert.equal(generated.visibleMaterialTotal, 1);
  assert.equal(generated.visibleProductGroups.length, 0);
  assert.equal(generated.ordinaryFilteredTotal, 1, 'generated assets remain visible as their own cards even when bound to a product');
});


test('tree checkbox selections expand parents and combine multiple leaf categories as a union', () => {
  const selected = normalizeMaterialLibrarySelection(['internal', 'industry', 'product', 'unrecognized']);
  assert.deepEqual(selected, ['product', 'enterprise', 'generated', 'industry']);
  assert.deepEqual(normalizeMaterialLibrarySelection(['external']), ['industry']);
  assert.deepEqual(normalizeMaterialLibrarySelection([]), []);
  const acrossBranches = normalizeMaterialLibrarySelection(['generated', 'industry']);
  assert.deepEqual(assets.filter(asset => materialMatchesLibrarySelection(asset, acrossBranches)).map(asset => asset.id), ['generated', 'official']);
  assert.equal(assets.filter(asset => materialMatchesLibrarySelection(asset, [])).length, 4);
  const filters: MaterialGalleryFilterSnapshot = { categories: acrossBranches,
    query: '', assetTab: 'all', type: 'all', industry: 'all', shotFunction: 'all', applicability: 'all',
    orientation: 'all', source: 'all', theme: 'all', favorite: 'all' };
  const result = projectMaterialGallery({ materials: assets, products: [{ id: 'p', name: '产品' }], summaries: {},
    filters, productFilter: { enabled: false, productId: '', productRef: '' }, page: 1, pageSize: 20 });
  assert.equal(result.visibleMaterialTotal, 2);
  assert.equal(result.visibleProductGroups.length, 0);
  assert.deepEqual(result.pagedUngroupedFilteredMaterials.map(asset => asset.id).sort(), ['generated', 'official']);
});
