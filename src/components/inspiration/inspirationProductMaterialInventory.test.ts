import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Material } from '../../lib/studioApi';
import type { fetchMaterialLibrary } from '../../lib/studioDigitalHuman';
import { fetchCompleteProductMaterialInventory, fetchProductMaterialSummaries } from './inspirationProductMaterialInventory';

const material = (id: string, productId: string) => ({ id, productId, productName: '' }) as Material;

test('product detail reads every exact-product page and deduplicates stable material IDs', async () => {
  const calls: Array<{ page?: number; productId?: string }> = [];
  const list = (async (_purpose: unknown, query: { page?: number; productId?: string }) => {
    calls.push(query);
    return { status: 'ready', sources: [], total: 101,
      items: query.page === 1 ? [material('first', 'product-a')] : [material('first', 'product-a'), material('last', 'product-a')],
      productSceneSlots: [] };
  }) as typeof fetchMaterialLibrary;
  const result = await fetchCompleteProductMaterialInventory({ id: 'product-a', name: 'A' }, list);
  assert.deepEqual(calls.map(call => [call.productId, call.page]), [['product-a', 1], ['product-a', 2]]);
  assert.deepEqual(result.materials.map(item => item.id), ['first', 'last']);
});

test('product summary reads shared pages sequentially and keeps product ownership isolated', async () => {
  const calls: number[] = [];
  const list = (async (_purpose: unknown, query: { page?: number }) => {
    calls.push(query.page || 0);
    return { status: 'ready', sources: [], total: 101,
      items: query.page === 1 ? [material('a', 'product-a')] : [material('b', 'product-b')],
      productSceneSlots: [] };
  }) as typeof fetchMaterialLibrary;
  const result = await fetchProductMaterialSummaries([{ id: 'product-a', name: 'A' },
    { id: 'product-b', name: 'B' }], list);
  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual(result['product-a']?.materials.map(item => item.id), ['a']);
  assert.deepEqual(result['product-b']?.materials.map(item => item.id), ['b']);
});
