import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAiProductOptions, enterpriseProductIdentity, resolveStudioProductIds, restoreStudioProductIds, resolveStudioProductOption } from './studioProductSelection.js';

test('enterprise product IDs survive rename and reorder and match material ownership priority', () => {
  const first = { id: 'catalog-a', productId: 'old-a', sku: 'A', name: '精华液', highlights: '保湿' };
  const second = { id: 'catalog-b', name: '面霜' };
  const original = buildAiProductOptions({ products: { items: [first, second] } });
  const changed = buildAiProductOptions({ products: { items: [second, { ...first, name: '新版精华液' }] } });
  assert.deepEqual(original.map(item => item.id), ['catalog-a', 'catalog-b']);
  assert.deepEqual(changed.map(item => item.id), ['catalog-b', 'catalog-a']);
  assert.equal(changed[1]?.catalogProductId, 'catalog-a');
  assert.match(changed[1]!.info, /新版精华液/);
  assert.equal(enterpriseProductIdentity({ id: ' ', productId: ' old-id ', sku: 'sku' }), 'old-id');
  assert.equal(enterpriseProductIdentity({ sku: 'sku' }), 'sku');
});

test('legacy drafts resolve by exact unique name, never by obsolete array index', () => {
  const options = buildAiProductOptions({ products: { items: [
    { id: 'b', name: '面霜' }, { id: 'a', name: '精华液' },
    { id: 'c', name: '同名' }, { id: 'd', name: '同名' },
  ] } });
  assert.deepEqual(resolveStudioProductIds(['product-0-精华液', 'b', 'a', 'product-9-同名', 'product-1-删除产品'], options), ['a', 'b']);
  // Exact canonical ID wins even when it resembles a legacy ID.
  assert.deepEqual(resolveStudioProductIds(['product-0-精华液'], [{ id: 'product-0-精华液', label: '新名字', info: '' }]), ['product-0-精华液']);
});

test('unlinked legacy product text is not advertised as a persisted catalog identity', () => {
  const options = buildAiProductOptions({ strategy: { focusProducts: '精华液、面霜' } });
  assert.equal(options.length, 2);
  assert.ok(options.every(item => item.id.startsWith('legacy-product:') && !item.catalogProductId));
  assert.deepEqual(resolveStudioProductIds(['product-0-精华液'], options), [options[0]!.id]);
});

test('draft restoration waits for tenant catalog hydration before resolving legacy IDs', () => {
  const ids = ['product-0-精华液'];
  assert.deepEqual(restoreStudioProductIds(ids, []), ids);
  assert.deepEqual(restoreStudioProductIds(ids, [{ id: 'kickoff-product', label: '视频任务', info: '' }]), ids);
  const options = buildAiProductOptions({ products: { items: [{ id: 'catalog-a', name: '精华液' }] } });
  assert.deepEqual(restoreStudioProductIds(ids, options), ['catalog-a']);
});

test('reference resolution prioritizes exact ID and refuses unknown IDs and ambiguous names', () => {
  const options = buildAiProductOptions({ products: { items: [
    { id: 'a', name: '同名' }, { id: 'b', name: '同名' }, { id: 'c', name: '精华液' },
  ] } });
  assert.equal(resolveStudioProductOption({ id: 'b', name: '同名' }, options)?.id, 'b');
  assert.equal(resolveStudioProductOption({ id: 'unknown', name: '精华液' }, options), undefined);
  assert.equal(resolveStudioProductOption({ name: '同名' }, options), undefined);
  assert.equal(resolveStudioProductOption({ id: 'product-0-同名', name: '同名' }, options), undefined);
  assert.equal(resolveStudioProductOption({ name: '精华液' }, options)?.id, 'c');
  assert.equal(resolveStudioProductOption({ id: 'product-9-精华液' }, options)?.id, 'c');
  assert.equal(resolveStudioProductOption({ id: 'c', name: '改名前的名称' }, options)?.id, 'c');
});
