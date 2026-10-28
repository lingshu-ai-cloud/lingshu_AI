import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import { resolveSocialImageProductCutout } from './socialImageProductCutout.js';

const metadata = { schemaVersion: 'material-asset.v2', assetRole: 'exact_product',
  contentRole: 'transparent_cutout', productIdentityLevel: 'exact', enterpriseCommon: false,
  subjectRefs: [], sceneType: null, personProductContact: null, occlusion: null,
  cleanPlate: null, cameraMotion: null, labelReadability: null, templateEligible: false,
  reuseScore: 0, segmentCandidates: [] };

test('product queue resolves only an exact transparent cutout, never the original photo', async () => {
  const photo = await sharp({ create: { width: 40, height: 80, channels: 3, background: '#00aabb' } }).png().toBuffer();
  const cutout = await sharp({ create: { width: 40, height: 80, channels: 4, background: '#00000000' } })
    .composite([{ input: await sharp({ create: { width: 20, height: 60, channels: 4, background: '#00aabbff' } }).png().toBuffer(), left: 10, top: 10 }]).png().toBuffer();
  const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const materials = [
    { id: 'original', tenantId: 'tenant-a', productId: 'sku-a', type: 'image', scope: 'own',
      contentSha256: digest(photo), materialV2: { ...metadata, contentRole: 'product_front' } },
    { id: 'cutout', tenantId: 'tenant-a', productId: 'sku-a', type: 'image', scope: 'own',
      contentSha256: digest(cutout), materialV2: metadata },
    { id: 'other-tenant', tenantId: 'tenant-b', productId: 'sku-a', type: 'image', scope: 'own',
      contentSha256: digest(cutout), materialV2: metadata },
  ];
  const readBytes = async (item: { id: string }) => ({ bytes: item.id === 'original' ? photo : cutout, mimeType: 'image/png' });
  const selected = await resolveSocialImageProductCutout({ tenantId: 'tenant-a', productId: 'sku-a', materials, readBytes });
  assert.equal(selected.materialId, 'cutout');
  assert.deepEqual(selected.bytes, cutout);
  await assert.rejects(resolveSocialImageProductCutout({ tenantId: 'tenant-a', productId: 'sku-b', materials, readBytes }),
    /social_image_product_cutout_required/);
  await assert.rejects(resolveSocialImageProductCutout({ tenantId: 'tenant-a', productId: 'sku-a',
    materials: [{ ...materials[1]!, contentSha256: digest(photo) }], readBytes: async () => ({ bytes: photo, mimeType: 'image/png' }) }),
  /social_image_product_cutout_required/);
});
