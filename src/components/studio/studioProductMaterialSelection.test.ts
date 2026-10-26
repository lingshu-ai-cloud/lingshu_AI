import test from 'node:test';
import assert from 'node:assert/strict';
import { productMaterialCandidates, reconcileProductMaterialSelection } from './studioProductMaterialSelection';
import type { Clip } from './studioSourceMaterial';
import { normalizeMaterialAssetV2 } from '../../../shared/contracts/materialAssetV2';

const clip = (id: string, productId = 'a', patch: Partial<Clip> = {}): Clip => ({
  id, productId, name: '同名产品图片', folder: 'upload', type: 'image', duration: 0,
  size: '1KB', url: `/assets/${id}.png`, scope: 'own', ...patch,
});
const materials = [clip('a1'), clip('a2'), clip('b1', 'b'), clip('factory', '')];

test('matches durable product IDs only, deduplicates, and excludes unusable/reference/shared/digital-human/audio assets', () => {
  const input = { productIds: ['a', 'b', 'a'], selectedIds: [], materials: [
    ...materials, clip('a1'), clip('name-only', '', { productName: 'a' }),
    clip('shared', 'a', { scope: 'shared' }), clip('reference', 'a', { usage: 'reference_only' }),
    clip('presenter', 'a', { sourceType: 'digital_human' }), clip('audio', 'a', { type: 'audio' }),
    clip('digital-input', 'a', { materialV2: normalizeMaterialAssetV2({ assetRole: 'digital_human_input' }) }),
    clip('authorization', 'a', { materialV2: normalizeMaterialAssetV2({ assetRole: 'person_authorization' }) }),
    clip('blocked', 'a', { capabilityManifest: { status: 'blocked' } as Clip['capabilityManifest'] }),
    clip('missing', 'a', { url: undefined }), clip('video-poster', 'a', { type: 'video', url: '', poster: '/poster.jpg' }),
  ] };
  assert.deepEqual(productMaterialCandidates(input).map(item => item.id), ['a1', 'a2', 'b1']);
  assert.deepEqual(reconcileProductMaterialSelection(null, input).selectedIds, ['a1', 'a2', 'b1']);
});

test('changing products removes automatic items but retains manually selected assets and preselected product assets', () => {
  const state = reconcileProductMaterialSelection(null, { productIds: ['a'], materials, selectedIds: ['factory', 'a1'] });
  assert.deepEqual(state.automaticIds, ['a2']);
  const next = reconcileProductMaterialSelection(state, { productIds: ['b'], materials, selectedIds: state.selectedIds });
  assert.deepEqual(next.selectedIds, ['factory', 'a1', 'b1']);
});

test('user deselection stays dismissed through asynchronous reloads until product is removed and reselected', () => {
  let state = reconcileProductMaterialSelection(null, { productIds: ['a'], materials, selectedIds: [] });
  state = reconcileProductMaterialSelection(state, { productIds: ['a'], materials, selectedIds: ['a2'] });
  assert.deepEqual(state.selectedIds, ['a2']);
  state = reconcileProductMaterialSelection(state, { productIds: ['a'], materials: [], selectedIds: state.selectedIds });
  state = reconcileProductMaterialSelection(state, { productIds: ['a'], materials, selectedIds: state.selectedIds });
  assert.equal(state.selectedIds.includes('a1'), false);
  state = reconcileProductMaterialSelection(state, { productIds: [], materials, selectedIds: state.selectedIds });
  state = reconcileProductMaterialSelection(state, { productIds: ['a'], materials, selectedIds: state.selectedIds });
  assert.deepEqual(state.selectedIds, ['a1', 'a2']);
});

test('late inventory loading adds eligible product materials without replacing manual choices', () => {
  const state = reconcileProductMaterialSelection(null, { productIds: ['a', 'b'], materials: [], selectedIds: ['manual'] });
  assert.deepEqual(reconcileProductMaterialSelection(state, { productIds: ['a', 'b'], materials, selectedIds: ['manual'] }).selectedIds,
    ['manual', 'a1', 'a2', 'b1']);
});

test('restored drafts keep historical choices through delayed inventory; newly chosen products still get defaults', () => {
  const state = reconcileProductMaterialSelection(null, {
    productIds: ['a'], materials: [], selectedIds: ['manual', 'a2'], preserveInitialSelection: true,
  });
  const loaded = reconcileProductMaterialSelection(state, { productIds: ['a'], materials, selectedIds: state.selectedIds });
  assert.deepEqual(loaded.selectedIds, ['manual', 'a2']);
  assert.deepEqual(reconcileProductMaterialSelection(loaded, { productIds: ['a', 'b'], materials, selectedIds: loaded.selectedIds }).selectedIds,
    ['manual', 'a2', 'b1']);
});

test('manually adding back a dismissed automatic item makes it a retained manual choice', () => {
  let state = reconcileProductMaterialSelection(null, { productIds: ['a'], materials, selectedIds: [] });
  state = reconcileProductMaterialSelection(state, { productIds: ['a'], materials, selectedIds: [] });
  state = reconcileProductMaterialSelection(state, { productIds: ['a'], materials, selectedIds: ['a1'] });
  assert.deepEqual(state.automaticIds, []);
  assert.deepEqual(reconcileProductMaterialSelection(state, { productIds: ['b'], materials, selectedIds: state.selectedIds }).selectedIds,
    ['a1', 'b1']);
});


test('active kickoff reference is never automatically selected even if bound to the same product', () => {
  const kickoff = { video: { sourceUrl: '/assets/a1.png' } } as Parameters<typeof reconcileProductMaterialSelection>[1]['kickoff'];
  assert.deepEqual(reconcileProductMaterialSelection(null, { productIds: ['a'], materials, selectedIds: [], kickoff }).selectedIds, ['a2']);
});
