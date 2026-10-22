import assert from 'node:assert/strict';
import test from 'node:test';
import { projectStudioMaterialLibrary } from './studioMaterialLibraryProjection.js';

const references = [{ id: 'product-1', name: '玻璃瓶' }, { id: 'product-2', name: '纸盒' }];
const materials = [
  { id: 'first', name: '玻璃瓶特写', scope: 'own', productId: 'product-1', createdAt: '2026-10-01T00:00:00Z' },
  { id: 'newest', name: '玻璃瓶工厂', scope: 'own', productId: 'product-1', createdAt: '2026-10-03T00:00:00Z' },
  { id: 'other', name: '纸盒', scope: 'own', productId: 'product-2', createdAt: '2026-10-02T00:00:00Z' },
  { id: 'internal', name: '草稿首帧', scope: 'own', productId: 'product-1', sourceType: 'ai-storyboard-first-frame', createdAt: '2026-10-04T00:00:00Z' },
];

test('product scope, internal-asset exclusion and pagination use one deterministic projection', () => {
  const result = projectStudioMaterialLibrary({
    enterpriseMaterials: [], inventoryMaterials: materials, productReferences: references, tenantId: 'tenant-1',
    query: { productId: 'product-1', page: '1', pageSize: '1' },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.sceneMaterials.length, 4);
  assert.equal(result.total, 2);
  assert.equal(result.pageSize, 1);
  assert.deepEqual(result.pageItems.map(item => item.id), ['newest']);
  assert.deepEqual(result.filteredMaterials.map(item => item.id), ['newest', 'first']);
  assert.equal(result.facets.sources.local_upload, 2);
});

test('conflicting product scope and invalid generation filters remain visible input errors', () => {
  const base = { enterpriseMaterials: [], inventoryMaterials: materials, productReferences: references, tenantId: 'tenant-1' };
  assert.equal(projectStudioMaterialLibrary({ ...base, query: { productId: 'product-1', excludeProductAssociated: '1' } }).error, '产品筛选条件冲突');
  assert.equal(projectStudioMaterialLibrary({ ...base, query: { assetGenerationKind: 'arbitrary' } }).error, '生成素材类型无效');
  assert.equal(projectStudioMaterialLibrary({ ...base, query: { qualityState: 'unknown' } }).error, '生成素材质量状态无效');
});

test('purpose=all can recover internal material while library view cannot', () => {
  const base = { enterpriseMaterials: [], inventoryMaterials: materials, productReferences: references, tenantId: 'tenant-1' };
  const all = projectStudioMaterialLibrary({ ...base, query: { purpose: 'all', productId: 'product-1' } });
  assert.equal(all.filteredMaterials.some(item => item.id === 'internal'), true);
  const library = projectStudioMaterialLibrary({ ...base, query: { productId: 'product-1' } });
  assert.equal(library.filteredMaterials.some(item => item.id === 'internal'), false);
});

test('inventory overrides a duplicate enterprise row and facets precede taxonomy filters', () => {
  const result = projectStudioMaterialLibrary({
    enterpriseMaterials: [{ id: 'first', name: '过期产品表素材', scope: 'own', productId: 'product-1', createdAt: '2026-09-01T00:00:00Z' }],
    inventoryMaterials: materials, productReferences: references, tenantId: 'tenant-1',
    query: { productId: 'product-1', sourceCategory: 'user_generated' },
  });
  assert.equal(result.sceneMaterials.find(item => item.id === 'first')?.name, '玻璃瓶特写');
  assert.equal(result.total, 0);
  assert.equal(result.facets.sources.local_upload, 2);
});
