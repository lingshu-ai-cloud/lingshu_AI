import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import { resolveSocialImageProductCutout } from './socialImageProductCutout.js';
import { cloudMaterialView } from '../lib/cloudMaterials.js';

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
  /social_image_product_cutout_invalid/);
  await assert.rejects(resolveSocialImageProductCutout({ tenantId: 'tenant-a', productId: 'sku-a',
    materials: [materials[1]!], readBytes: async () => { throw new Error('storage unavailable'); } }),
  /social_image_product_cutout_unreadable/);
});

test('cloud cutout projection retains the object key needed to read and verify its bytes', async () => {
  const cutout = await sharp({ create: { width: 40, height: 80, channels: 4, background: '#00000000' } })
    .composite([{ input: await sharp({ create: { width: 20, height: 60, channels: 4, background: '#00aabbff' } }).png().toBuffer(), left: 10, top: 10 }]).png().toBuffer();
  const sha256 = createHash('sha256').update(cutout).digest('hex');
  const material = cloudMaterialView({ id: 'uploaded-cutout', tenantId: 'tenant-a', scope: 'own', type: 'image',
    productId: 'sku-a', sha256, objectKey: 'materials/tenants/tenant-a/cutout.png',
    provenance: { materialAssetV2: metadata } });
  const selected = await resolveSocialImageProductCutout({ tenantId: 'tenant-a', productId: 'sku-a', materials: [material],
    readBytes: async item => {
      assert.equal(item.objectKey, 'materials/tenants/tenant-a/cutout.png');
      return { bytes: cutout, mimeType: 'image/png' };
    } });
  assert.equal(selected.materialId, 'pb-uploaded-cutout');
  assert.equal(selected.contentSha256, sha256);
});

test('a generated cutout is not reused after its product source image changes', async () => {
  const cutout = await sharp({ create: { width: 40, height: 80, channels: 4, background: '#00000000' } })
    .composite([{ input: await sharp({ create: { width: 20, height: 60, channels: 4, background: '#00aabbff' } }).png().toBuffer(), left: 10, top: 10 }]).png().toBuffer();
  const material = { id: 'old-cutout', tenantId: 'tenant-a', productId: 'sku-a', type: 'image', scope: 'own',
    contentSha256: createHash('sha256').update(cutout).digest('hex'), materialV2: metadata,
    provenance: { cutoutSourceSha256: 'a'.repeat(64) } };
  await assert.rejects(resolveSocialImageProductCutout({ tenantId: 'tenant-a', productId: 'sku-a',
    sourceSha256: 'b'.repeat(64), materials: [material], readBytes: async () => ({ bytes: cutout, mimeType: 'image/png' }) }),
  /social_image_product_cutout_required/);
});
