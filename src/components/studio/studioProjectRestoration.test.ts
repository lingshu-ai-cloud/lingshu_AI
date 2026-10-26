import assert from 'node:assert/strict';
import test from 'node:test';
import { createStudioProjectRestoration } from './studioProjectRestoration';
import { buildAiProductOptions } from './studioProductSelection';
import type { StudioProjectLifecyclePorts } from './studioProjectLifecyclePorts';

// Exercise the existing restoration entry with captured state writes. The editor's
// unrelated setters stay inert; no network, supplier or rendering actions run.
function restorationFixture(extra: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {};
  const fields: Record<string, unknown> = {
    productOptions: buildAiProductOptions({ products: { items: [{ id: 'catalog-a', name: '精华液' }, { id: 'catalog-b', name: '面霜' }] } }),
    enterpriseVoiceLangs: [], voiceoverAudios: {}, languageRenderOutputs: {}, languageRenderVersions: {}, storyboardVideoVersions: {},
    notification: { destroy: () => {} }, adoptEditorProjectRevision: () => {}, autoGen: { current: false }, ...extra,
  };
  const ports = new Proxy(fields, {
    get(target, name: string | symbol) {
      if (typeof name !== 'string') return undefined;
      if (name in target) return target[name];
      if (name.endsWith('Ref') || name === 'masterScriptSnapshot') return target[name] = { current: null };
      if (name.startsWith('set')) return target[name] = (value: unknown) => { state[name] = value; };
      if (name === 'rememberSocialShotMaterialBindings' || name === 'restoreProductMaterialSelection') return (value: unknown) => { state[name] = value; };
      return undefined;
    },
  }) as unknown as StudioProjectLifecyclePorts;
  const actions = createStudioProjectRestoration(ports);
  return { state, restore: actions.applySpec, load: actions.loadProject };
}

test('restoring a draft migrates every assembly shot product binding, including inactive assemblies', () => {
  const { state, restore } = restorationFixture();
  restore({ selectedProductIds: ['product-0-精华液'], activeAssemblyId: 'second', storyboardSourcePlans: { top: { productIds: ['product-0-精华液'] } },
    storyboardAssemblies: [
      { id: 'first', name: '第一条', sourcePlans: { one: { productIds: ['product-0-精华液'], firstFrameMaterialId: 'img-a' } } },
      { id: 'second', name: '第二条', sourcePlans: { two: { productIds: ['product-1-面霜'], confirmed: true } } },
    ] });
  assert.deepEqual(state.setSelectedProductIds, ['catalog-a']);
  const assemblies = state.setStoryboardAssemblies as Array<{ sourcePlans: Record<string, { productIds: string[]; firstFrameMaterialId?: string }> }>;
  assert.deepEqual(assemblies[0]!.sourcePlans.one, { productIds: ['catalog-a'], firstFrameMaterialId: 'img-a' });
  assert.deepEqual(assemblies[1]!.sourcePlans.two, { productIds: ['catalog-b'], confirmed: true });
  assert.deepEqual(state.setStoryboardSourcePlans, assemblies[1]!.sourcePlans);
});

test('legacy drafts without assemblies migrate top-level shot bindings and reuse them for the default assembly', () => {
  const { state, restore } = restorationFixture();
  restore({ storyboardSourcePlans: { shot: { productIds: ['product-0-精华液'], confirmed: false } } });
  assert.deepEqual(state.setStoryboardSourcePlans, { shot: { productIds: ['catalog-a'], confirmed: false } });
  assert.deepEqual((state.setStoryboardAssemblies as Array<{ sourcePlans: unknown }>)[0]!.sourcePlans, state.setStoryboardSourcePlans);
});

test('project restoration hands persisted automatic ownership and explicit opt-outs to the existing selection hook', () => {
  const { state, restore } = restorationFixture();
  const selection = { productIds: ['catalog-a'], selectedIds: ['image-a'], automaticIds: ['image-a'],
    dismissedIds: ['image-a-other'], preservedProductIds: [], candidateProductIds: { 'image-a': 'catalog-a', 'image-a-other': 'catalog-a' } };
  restore({ selectedProductIds: ['catalog-a'], selected: selection.selectedIds, productMaterialSelection: selection });
  assert.deepEqual(state.restoreProductMaterialSelection, selection);
  assert.deepEqual(state.setSelected, selection.selectedIds);
  restore({ selectedProductIds: ['catalog-b'], selected: [] });
  assert.equal(state.restoreProductMaterialSelection, undefined, 'legacy restoration explicitly clears the previous project ownership');
});

test('an explicit continuation keeps the new confirmed selection instead of the older project selection', () => {
  const selection = { productIds: ['catalog-b'], selectedIds: [], automaticIds: [], dismissedIds: ['image-b'], preservedProductIds: [], candidateProductIds: { 'image-b': 'catalog-b' } };
  const { state, load } = restorationFixture({ incomingCreateRequest: { requestId: 2, continueProjectId: 'draft-1', productMaterialSelection: selection } });
  load({ id: 'draft-1', title: '旧草稿', status: 'draft', spec: { selected: ['image-a'], productMaterialSelection: { ...selection, selectedIds: ['image-a'] } }, createdAt: '2026-10-26', updatedAt: 'v1' });
  assert.deepEqual(state.restoreProductMaterialSelection, selection);
  assert.deepEqual(state.setSelected, [], 'an intentionally empty selection must not fall back to older materials');
});
