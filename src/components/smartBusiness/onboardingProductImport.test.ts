import assert from 'node:assert/strict';
import test from 'node:test';
import { importOnboardingProducts, mergeOnboardingProducts, onboardingProductName } from './onboardingProductImport';

test('matching SKU updates a product while preserving its stable enterprise identity', () => {
  const existing = [{ id: 'product-1', sku: 'A-1', name: '旧名称', category: '产品' }];
  const merged = mergeOnboardingProducts(existing, [{ id: 'import-1', sku: 'A-1', name: '新名称' }, { id: 'import-2', sku: 'B-2', name: '新产品' }]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 'product-1');
  assert.equal(merged[0].name, '新名称');
  assert.equal(merged[0].category, '产品');
  assert.equal(onboardingProductName(merged[1]), '新产品');
  assert.equal(existing[0].name, '旧名称');
});

test('unsupported and oversized files fail before any upload or profile write', async () => {
  await assert.rejects(importOnboardingProducts(new File(['x'], 'product.png'), []), /请选择 Excel/);
  const oversized = new File(['x'], 'product.txt');
  Object.defineProperty(oversized, 'size', { value: 50 * 1024 * 1024 + 1 });
  await assert.rejects(importOnboardingProducts(oversized, []), /文件不能超过 50MB/);
});

test('TXT import remains a draft and does not write confirmed enterprise facts', async () => {
  let uploads = 0;
  const result = await importOnboardingProducts(new File(['产品名称：玻璃瓶\nSKU：A-1'], 'products.txt'), [], async file => {
    uploads += 1;
    return { name: file.name, type: 'text/plain', size: file.size, updatedAt: '2026-10-24T00:00:00.000Z',
      url: '/api/overseas/enterprise/assets/source.txt', sha256: 'a'.repeat(64) };
  });
  assert.equal(result.importedCount, 1);
  assert.equal(result.products[0].name, '玻璃瓶');
  assert.equal(uploads, 1);
  assert.equal(result.sourceEvidence.sha256, 'a'.repeat(64));
});
