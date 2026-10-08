import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEnterpriseProductSelection } from './socialContentTasks.js';

test('repairs a stale product id from one exact current name or SKU match', () => {
  const products = [
    { id: 'current-serum', sku: 'SERUM-01', name: '维C精华液' },
    { id: 'current-mask', sku: 'MASK-01', name: '树莓美白嫩肤面膜' },
  ];
  assert.deepEqual(
    resolveEnterpriseProductSelection(products, { productId: 'retired-import-id', productRef: '树莓美白嫩肤面膜' }),
    { item: products[1], canonicalId: 'current-mask' },
  );
  assert.deepEqual(
    resolveEnterpriseProductSelection(products, { productId: 'retired-import-id', productRef: 'serum-01' }),
    { item: products[0], canonicalId: 'current-serum' },
  );
});

test('keeps a valid canonical id and rejects ambiguous or invented fallbacks', () => {
  const products = [
    { id: 'product-a', name: '同名面膜' },
    { id: 'product-b', name: '同名面膜' },
  ];
  assert.equal(resolveEnterpriseProductSelection(products, { productId: 'product-b', productRef: '旧名称' })?.canonicalId, 'product-b');
  assert.equal(resolveEnterpriseProductSelection(products, { productId: 'retired-id', productRef: '同名面膜' }), null);
  assert.equal(resolveEnterpriseProductSelection(products, { productId: 'retired-id', productRef: '不存在的产品' }), null);
});
