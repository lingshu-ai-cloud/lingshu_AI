import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { analyzeSocialImageReference, enterpriseProductImageAuthorization, inspectSocialImageAsset, socialImageAssetAuthorization,
  socialImageAssetManifest } from './socialImageEvidenceWorker.js';

test('required asset inspection is based on decodable bytes and preserves OCR observations', async () => {
  const bytes = await sharp({ create: { width: 240, height: 300, channels: 4, background: '#ddeeff' } }).png().toBuffer();
  const inspected = await inspectSocialImageAsset({ assetId: 'product-a', role: 'product', required: true,
    bytes, mimeType: 'image/png', ocr: async () => [{ text: 'PRODUCT A', bbox: { x: .2, y: .3, width: .5, height: .1 }, confidence: .91 }] });
  assert.equal(inspected.readable, true);
  assert.deepEqual(inspected.dimensions, { width: 240, height: 300 });
  assert.match(inspected.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(inspected.rights, 'unknown', 'readable bytes and a matching hash do not confer commercial rights');
  assert.deepEqual(inspected.ocr, ['PRODUCT A']);
  const authorizedRecord = { id: 'product-a', tenantId: 'tenant-a', scope: 'own', rightsStatus: 'authorized',
    rightsEvidenceRef: 'license:product-a', commercialUseApproved: true, derivativesApproved: true,
    rawLibraryUseApproved: true };
  assert.equal(socialImageAssetAuthorization({ ...authorizedRecord, tenantId: 'tenant-b' }, 'tenant-a'), null);
  assert.equal(socialImageAssetAuthorization({ ...authorizedRecord, derivativesApproved: false }, 'tenant-a'), null);
  assert.equal(socialImageAssetAuthorization({ ...authorizedRecord, rawLibraryUseApproved: false }, 'tenant-a'), null);
  const authorized = await inspectSocialImageAsset({ assetId: 'product-a', role: 'product', required: true,
    bytes, mimeType: 'image/png', expectedContentHash: inspected.contentHash,
    authorization: socialImageAssetAuthorization(authorizedRecord, 'tenant-a') });
  assert.equal(authorized.rights, 'cleared');
  assert.equal(authorized.rightsEvidenceRef, 'license:product-a');
  const unauthorizedChanged = await inspectSocialImageAsset({ assetId: 'product-a', role: 'product', required: true,
    bytes, mimeType: 'image/png', expectedContentHash: '0'.repeat(64),
    authorization: socialImageAssetAuthorization(authorizedRecord, 'tenant-a') });
  assert.equal(unauthorizedChanged.rights, 'unknown');
  const staleBinding = await inspectSocialImageAsset({ assetId: 'product-stale', role: 'product', required: true,
    bytes, mimeType: 'image/png', expectedContentHash: '0'.repeat(64) });
  assert.equal(staleBinding.readable, false, 'a stale binding hash must not silently accept different bytes');
  assert.equal(staleBinding.rights, 'unknown');
  const missing = await inspectSocialImageAsset({ assetId: 'product-b', role: 'product', required: true,
    bytes: Buffer.from('not-an-image'), mimeType: 'image/png' });
  assert.equal(missing.readable, false);
  assert.equal(socialImageAssetManifest({ assets: [missing], ocrAvailable: false }).missingCapabilities[0], 'local_ocr_unavailable');
  const oriented = await sharp({ create: { width: 240, height: 300, channels: 3, background: '#ddeeff' } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const orientedInspection = await inspectSocialImageAsset({ assetId: 'product-oriented', role: 'product', required: true,
    bytes: oriented, mimeType: 'image/jpeg' });
  assert.deepEqual(orientedInspection.dimensions, { width: 300, height: 240 }, 'EXIF orientation must be applied before evidence dimensions');
});
test('tenant enterprise product images are authorized without a separate material license record', async () => {
  const bytes = await sharp({ create: { width: 240, height: 300, channels: 4, background: '#ddeeff' } }).png().toBuffer();
  const authorization = enterpriseProductImageAuthorization('tenant-a', 'GUIANFA-RS-004');
  const inspected = await inspectSocialImageAsset({ assetId: 'GUIANFA-RS-004', role: 'product', required: true,
    bytes, mimeType: 'image/png', authorization });
  assert.equal(inspected.readable, true);
  assert.equal(inspected.rights, 'cleared');
  assert.equal(inspected.rightsEvidenceRef, 'enterprise_profile:tenant-a:product:GUIANFA-RS-004');
  const stale = await inspectSocialImageAsset({ assetId: 'GUIANFA-RS-004', role: 'product', required: true,
    bytes, mimeType: 'image/png', expectedContentHash: '0'.repeat(64), authorization });
  assert.equal(stale.readable, false, 'a changed product image must still fail its task hash binding');
  const invalid = await inspectSocialImageAsset({ assetId: 'GUIANFA-RS-004', role: 'product', required: true,
    bytes: Buffer.from('not-an-image'), mimeType: 'image/png', authorization });
  assert.equal(invalid.readable, false, 'default authorization does not bypass image decoding');
});
test('reference worker emits normalized region, saliency and OCR evidence from actual pixels', async () => {
  const base = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#202020' } }).png().toBuffer();
  const bytes = await sharp(base).composite([{ input: await sharp({ create: { width: 100, height: 100, channels: 3,
    background: '#ffffff' } }).png().toBuffer(), left: 200, top: 0 }]).png().toBuffer();
  const result = await analyzeSocialImageReference({ bytes, mimeType: 'image/png', referenceId: 'reference-a',
    ocr: async () => [{ text: 'SALE', bbox: { x: .7, y: .05, width: .2, height: .1 }, confidence: .95 }] });
  assert.equal(result.canvas.width, 300);
  assert.equal(result.regions.length, 9);
  assert.equal(result.saliencyOrder.length, 9);
  assert.ok(result.regions.every(region => region.bbox.x >= 0 && region.bbox.y >= 0
    && region.bbox.x + region.bbox.width <= 1.001 && region.bbox.y + region.bbox.height <= 1.001
    && /^[a-f0-9]{64}$/.test(region.evidenceRef.contentHash)));
  assert.deepEqual(result.ocrBlocks[0], { text: 'SALE', bbox: { x: .7, y: .05, width: .2, height: .1 }, confidence: .95 });
  assert.equal(result.informationHierarchy[0], 'SALE');
  assert.equal(result.observations.length, 9);
});
