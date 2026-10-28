import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { prepareProductBundleImport } from './productBundleImport.js';
import { confirmEnterpriseProductImportAssets } from './enterpriseProductImportConfirmation.js';

test('private product bundle verifies bytes and binds imported URLs to the current upload session', async () => {
  const bytes = Buffer.from('89504e470d0a1a0a', 'hex');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const bundle = { schemaVersion: 'lingshu-product-bundle.v1', productCount: 1, assetCount: 1,
    products: [{ id: 'sku-a', name: '测试产品', sku: 'SKU-A', imageUrl: '/media/tenants/old/source.png' }],
    assets: [{ productIndex: 0, field: 'imageUrl', name: 'source.png', mimeType: 'image/png', sha256, dataBase64: bytes.toString('base64') }] };
  const file = new File([JSON.stringify(bundle)], 'products.lingshu-products.json', { type: 'application/json' });
  const pending = await prepareProductBundleImport(file);
  assert.equal(pending.products[0]?.imageUrl, undefined);
  const result = await confirmEnterpriseProductImportAssets(pending, {
    upload: async () => ({ name: 'source.png', type: 'image/png', size: bytes.length,
      updatedAt: '2026-10-29T00:00:00Z', url: '/api/overseas/enterprise/assets/new-account.png' }),
    importUrl: async () => { throw new Error('remote URL must not be used'); },
  });
  assert.equal(result.status, 'ready');
  if (result.status === 'ready') assert.equal(result.pending.products[0]?.imageUrl, '/api/overseas/enterprise/assets/new-account.png');
  await assert.rejects(prepareProductBundleImport(new File([JSON.stringify({ ...bundle,
    assets: [{ ...bundle.assets[0], sha256: '0'.repeat(64) }] })], file.name)), /校验失败/);
});
