import assert from 'node:assert/strict';
import test from 'node:test';
import type { Material } from '../../lib/studioApi';
import { readSocialProductMaterialInventory } from './useSocialProductMaterials';

const material = (id: string, scope: 'own' | 'shared' = 'own') => ({ id, scope }) as Material;
test('inventory reads the full unpaginated tenant library and excludes shared assets', async () => {
  const own = Array.from({ length: 120 }, (_, index) => material(`own-${index}`));
  const list: Parameters<typeof readSocialProductMaterialInventory>[0] = async (purpose, filters) => {
    assert.equal(purpose, 'library');
    assert.equal(filters, undefined, 'without pagination query the server returns all materials');
    return { items: [...own, material('public', 'shared')], status: 'ready', sources: [] };
  };
  assert.deepEqual(await readSocialProductMaterialInventory(list), own);
});
test('partial inventory must remain an explicit read failure instead of a false empty list', async () => {
  await assert.rejects(readSocialProductMaterialInventory(async () => ({ items: [], status: 'partial', sources: [{ source: 'cloud', state: 'unavailable', message: '素材源中断' }] })), /素材源中断/);
});
