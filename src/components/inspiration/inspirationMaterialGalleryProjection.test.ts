import assert from 'node:assert/strict';
import test from 'node:test';
import type { Material } from '../../lib/studioApi';
import { projectMaterialGallery } from './inspirationMaterialGalleryProjection';
import type { MaterialGalleryFilterSnapshot } from './inspirationMaterialLibrary';

const allFilters: MaterialGalleryFilterSnapshot = {
  query: '', assetTab: 'all', type: 'all', industry: 'all', shotFunction: 'all',
  applicability: 'all', orientation: 'all', source: 'all', theme: 'all', favorite: 'all',
};
const product = { id: 'product-1', name: '包装产品' };
const makeMaterial = (id: string, fields: Record<string, unknown> = {}) => ({
  id, name: id, type: 'image', productId: '', productName: '', tags: '', sourceType: 'local_upload',
  createdAt: '2026-10-01T00:00:00Z', ...fields,
}) as unknown as Material;

test('gallery keeps product groups on first page and pages ordinary materials without mutating input', () => {
  const userUpload = makeMaterial('uploaded', { createdAt: '2026-10-01T00:00:00Z' });
  const migratedSeed = makeMaterial('seed', { sourceType: 'official_import', createdAt: '2026-10-22T00:00:00Z' });
  const productMaterial = makeMaterial('product', { productId: product.id, productName: product.name });
  const materials = [migratedSeed, productMaterial, userUpload];
  const input = { materials, products: [product], summaries: { [product.id]: { materials: [productMaterial], slots: [], loading: false, error: '' } }, filters: allFilters, productFilter: { enabled: false, productId: '', productRef: '' }, pageSize: 1 };
  const first = projectMaterialGallery({ ...input, page: 1 });
  assert.deepEqual(first.visibleProductGroups, [product]);
  assert.deepEqual(first.pagedUngroupedFilteredMaterials.map(item => item.id), ['uploaded']);
  assert.equal(first.visibleMaterialTotal, 3);
  assert.equal(first.visibleMaterialGalleryCount, 2);
  const second = projectMaterialGallery({ ...input, page: 2 });
  assert.deepEqual(second.visibleProductGroupsForPage, []);
  assert.deepEqual(second.pagedUngroupedFilteredMaterials.map(item => item.id), ['seed']);
  assert.equal(second.visibleMaterialGalleryCount, 1);
  assert.deepEqual(materials.map(item => item.id), ['seed', 'product', 'uploaded']);
});

test('gallery requires actual summary material for restrictive filters, but allows a name match without them', () => {
  const input = { materials: [] as Material[], products: [product], summaries: {}, productFilter: { enabled: false, productId: '', productRef: '' }, page: 1, pageSize: 20 };
  assert.deepEqual(projectMaterialGallery({ ...input, filters: { ...allFilters, query: '包装' } }).visibleProductGroups, [product]);
  assert.deepEqual(projectMaterialGallery({ ...input, filters: { ...allFilters, query: '包装', type: 'video' } }).visibleProductGroups, []);
  assert.deepEqual(projectMaterialGallery({ ...input, filters: allFilters, productFilter: { enabled: true, productId: '', productRef: '' } }).visibleProductGroups, []);
});

test('gallery applies product scope and exposes functions from complete product inventory', () => {
  const productMaterial = makeMaterial('product', { productId: product.id, shotFunction: 'packaging, product_demo' });
  const otherMaterial = makeMaterial('other', { productId: 'other-product', shotFunction: 'factory_proof' });
  const result = projectMaterialGallery({
    materials: [otherMaterial], products: [product],
    summaries: { [product.id]: { materials: [productMaterial], slots: [], loading: false, error: '' } },
    filters: { ...allFilters, shotFunction: 'packaging' },
    productFilter: { enabled: true, productId: product.id, productRef: product.name }, page: 1, pageSize: 20,
  });
  assert.deepEqual(result.visibleProductGroups, [product]);
  assert.equal(result.ordinaryFilteredTotal, 0);
  assert.deepEqual(result.materialFunctionOptions, ['factory_proof', 'packaging', 'product_demo'].sort((a, b) => {
    const labels: Record<string, string> = { factory_proof: '工厂背书', packaging: '包装交付', product_demo: '产品展示' };
    return labels[a].localeCompare(labels[b], 'zh-CN');
  }));
});
