import assert from 'node:assert/strict';
import test from 'node:test';
import { searchEnterpriseProducts } from './enterpriseProductSearch';

const products = [
  { id: 'a', name: '面霜', sku: 'RS-001', brand: 'GUIANFA' },
  { id: 'b', name: '云朵泡沫卸妆蜜', sku: 'RS-002', brand: 'Aurelia' },
  { id: 'c', name: '修护精华', sku: 'RS-003', brand: 'Aurelia' },
];
test('catalog search covers all products by name, SKU and brand, case-insensitively', () => {
  assert.deepEqual(searchEnterpriseProducts(products, '卸妆').map(item => item.product.id), ['b']);
  assert.deepEqual(searchEnterpriseProducts(products, 'rs-003').map(item => item.index), [2]);
  assert.deepEqual(searchEnterpriseProducts(products, 'aurelia 修护').map(item => item.index), [2]);
  assert.equal(searchEnterpriseProducts(products, '无匹配').length, 0);
  assert.equal(searchEnterpriseProducts(products, ' ').length, 3);
});
test('filtered pagination preserves original edit/delete indexes', () => {
  const entries = searchEnterpriseProducts(products, 'aurelia');
  const secondPage = entries.slice(1, 2);
  assert.equal(secondPage[0]?.index, 2);
  assert.equal(products[secondPage[0]!.index]?.id, 'c');
  assert.deepEqual(searchEnterpriseProducts(products, '').map(item => item.index), [0, 1, 2]);
});
