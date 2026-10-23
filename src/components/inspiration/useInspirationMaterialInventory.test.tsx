import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { studioApi, type Material } from '../../lib/studioApi';
import { useInspirationMaterialInventory } from './useInspirationMaterialInventory';

function inventory() {
  let result: ReturnType<typeof useInspirationMaterialInventory> | undefined;
  renderToStaticMarkup(createElement(() => {
    result = useInspirationMaterialInventory({ innerView: 'library', materialSource: 'all', materialTheme: 'all', materialProducts: [] });
    return null;
  }));
  assert.ok(result);
  return result;
}

const material = (id: string) => ({ id, name: id, url: `/${id}.mp4` }) as Material;
const page = (items: Material[], total = items.length) => ({ status: 'ready' as const, sources: [], items, total });

test('library refresh reads all common-material pages and deduplicates before returning preview candidates', async () => {
  const original = studioApi.listMaterialLibrary;
  const calls: Array<Parameters<typeof original>[1]> = [];
  studioApi.listMaterialLibrary = async (_purpose, query) => {
    calls.push(query);
    return query?.page === 1 ? page([material('first')], 101) : page([material('first'), material('last')], 101);
  };
  try {
    const result = await inventory().refreshMaterials(2);
    assert.deepEqual(result.map(item => item.id), ['first', 'last']);
    assert.deepEqual(calls.map(query => [query?.page, query?.pageSize, query?.excludeProductAssociated]), [[1, 100, true], [2, 100, true]]);
  } finally { studioApi.listMaterialLibrary = original; }
});

test('an older refresh cannot return its late response as the active inventory', async () => {
  const original = studioApi.listMaterialLibrary;
  const pending: Array<(value: Awaited<ReturnType<typeof original>>) => void> = [];
  studioApi.listMaterialLibrary = () => new Promise(resolve => pending.push(resolve));
  try {
    const current = inventory();
    const older = current.refreshMaterials();
    const newer = current.refreshMaterials();
    pending[1]!(page([material('newer')]));
    assert.deepEqual((await newer).map(item => item.id), ['newer']);
    pending[0]!(page([material('older')]));
    assert.deepEqual(await older, [], 'stale refresh must return the captured previous inventory, never late rows');
  } finally { studioApi.listMaterialLibrary = original; }
});
