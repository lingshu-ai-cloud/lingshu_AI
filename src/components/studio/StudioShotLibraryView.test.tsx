import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReactElement } from 'react';
import { renderStudioShotLibrary } from './StudioShotLibraryView';
import type { StudioShotLibraryViewInputs } from './studioShotLibraryViewInputs';

const nestedProps = (element: ReactElement) => (element.props as { children: ReactElement }).children.props as Record<string, unknown>;

test('shot gap upload binds by catalog ID even after reorder or rename and preserves the other product', async t => {
  const originalReader = globalThis.FileReader;
  const originalStorage = globalThis.localStorage;
  t.after(() => { globalThis.FileReader = originalReader; globalThis.localStorage = originalStorage; });
  globalThis.localStorage = { getItem: () => null } as unknown as Storage;
  globalThis.FileReader = class {
    result = 'data:image/png;base64,AAAA';
    onload?: () => void;
    readAsDataURL() { this.onload?.(); }
  } as unknown as typeof FileReader;
  const profile = { products: { items: [
    { id: 'catalog-a', name: '同名', images: [{ name: 'keep', url: '/old.png' }] },
    { id: 'catalog-b', name: '已改名', images: [] },
  ] }, factVersion: { contentHash: 'version-1' } };
  let savedProducts: typeof profile.products | undefined;
  let refreshed = false;
  t.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    if (url === '/api/overseas/enterprise/profile' && !init?.method) return new Response(JSON.stringify(profile));
    if (url === '/api/overseas/enterprise/assets') return new Response(JSON.stringify({ name: 'new.png', url: '/new.png' }));
    assert.equal(url, '/api/overseas/enterprise/profile');
    assert.equal(init?.method, 'PATCH');
    assert.equal((init.headers as Record<string, string>)['If-Match'], 'version-1');
    savedProducts = JSON.parse(String(init.body)).products;
    return new Response(JSON.stringify({ ok: true, profile: { ...profile, products: savedProducts } }));
  });
  const input = {
    storyboardSlots: [{ id: 'shot-1' }], batchReviewIssues: [], storyboardGenerating: {}, renderReadiness: { ready: false },
    productionFor: () => ({}), sourcePlanFor: () => ({ productIds: ['catalog-b'] }), storyboardTopicFor: () => 'product',
    productionDefaults: { presenters: [] }, selectedProductOptions: [{ id: 'catalog-b', label: '旧名字', info: '' }],
    canRequestShootingFor: () => false, batchShotResults: [], setProductOptions: () => {}, refreshMaterials: async () => { refreshed = true; },
  } as unknown as StudioShotLibraryViewInputs;
  const props = nestedProps(renderStudioShotLibrary(input));
  const renderActions = props.renderIssueActions as (issue: { id: string; detail: string; question: string }) => ReactElement;
  const actionProps = nestedProps(renderActions({ id: 'shot-1', detail: '缺少可读取的图片', question: '' }));
  await (actionProps.onUpload as (productId: string, file: File) => Promise<void>)('catalog-b', new File(['image'], 'new.png', { type: 'image/png' }));
  assert.deepEqual(savedProducts?.items[0], profile.products.items[0]);
  assert.deepEqual(savedProducts?.items[1]?.images, [{ name: 'new.png', url: '/new.png' }]);
  assert.equal(refreshed, true);
});
