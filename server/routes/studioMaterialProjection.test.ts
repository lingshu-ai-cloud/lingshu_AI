import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyAssetToken } from '../lib/assetAccess.js';
import { enterpriseProductMaterials, materialResponse, type Material } from './studioMaterialProjection.js';
import type { EnterpriseProfile } from './enterpriseProfileContracts.js';

test('tenant material projection signs playback and removes private object keys', async () => {
  const material: Material = {
    id: 'material-a', name: 'Source', folder: 'uploads', type: 'video', duration: 4,
    size: '1 MB', file: 'source.mp4', url: '', objectKey: 'private/video.mp4',
    posterObjectKey: 'private/poster.jpg', scope: 'own', tenantId: 'tenant-a',
    createdAt: '2026-10-23T00:00:00.000Z',
  };
  const visible = await materialResponse(material, 'tenant-a');
  assert.equal(visible.canManage, true);
  assert.equal(visible.objectKey, undefined);
  assert.equal(visible.posterObjectKey, undefined);
  const signed = new URL(visible.url, 'http://local');
  assert.deepEqual(verifyAssetToken(signed.searchParams.get('assetToken'), signed.pathname), { tenantId: 'tenant-a' });
  assert.equal(visible.capabilityManifest !== undefined, true);
});

test('enterprise product assets retain stable identity and stay non-manageable', async () => {
  const profile = { products: { items: [{ id: 'product-a', name: 'Bottle', imageUrl: 'https://example.test/bottle.jpg' }] } } as unknown as EnterpriseProfile;
  const first = enterpriseProductMaterials('tenant-a', profile);
  const second = enterpriseProductMaterials('tenant-a', profile);
  assert.equal(first.length, 1);
  assert.equal(first[0]!.id, second[0]!.id);
  assert.equal(first[0]!.productId, 'product-a');
  assert.equal(first[0]!.sourceType, 'enterprise_product_table');
  assert.equal(first[0]!.rightsStatus, 'authorized');
  assert.equal((await materialResponse(first[0]!, 'tenant-a')).canManage, false);
});
