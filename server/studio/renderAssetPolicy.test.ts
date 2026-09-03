import assert from 'node:assert/strict';
import { signAssetUrl, signPathAssetUrl } from '../lib/assetAccess.js';
import {
  RenderAssetPolicyError,
  isPrivateOrReservedAddress,
  validateRenderManifestAssets,
} from './renderAssetPolicy.js';

const previousSecret = process.env.ASSET_ACCESS_SECRET;
process.env.ASSET_ACCESS_SECRET = 'render-policy-test-secret';
const origin = 'https://app.example.test';
const tenantId = 'tenant-render-policy';
const manifest = (url: string) => ({
  jobId: 'ignored-client-job',
  spec: { duration: 1, ratio: '1:1' },
  timeline: url ? [{ type: 'image', url }] : [],
  voiceover: { url: null },
  bgm: { url: null },
  cover: { url: null },
});

async function rejectsCode(work: Promise<void>, code: string): Promise<void> {
  await assert.rejects(work, error => error instanceof RenderAssetPolicyError && error.code === code);
}

try {
  const signedMedia = `${origin}${signAssetUrl('/media/tenants/tenant-render-policy/asset.png', tenantId)}`;
  await validateRenderManifestAssets({ manifest: manifest(signedMedia), origin, tenantId });

  const signedCloudPath = `${origin}${signPathAssetUrl('/cloud-files/material-1/media.mp4', tenantId)}`;
  await validateRenderManifestAssets({ manifest: manifest(signedCloudPath), origin, tenantId });

  await validateRenderManifestAssets({
    manifest: manifest('data:image/png;base64,iVBORw0KGgo='),
    origin,
    tenantId,
  });

  await rejectsCode(
    validateRenderManifestAssets({ manifest: manifest(`${origin}/media/asset.png`), origin, tenantId }),
    'render_asset_same_origin_signature_invalid',
  );
  const wrongTenant = `${origin}${signAssetUrl('/media/tenants/tenant-render-policy/asset.png', 'another-tenant')}`;
  await rejectsCode(
    validateRenderManifestAssets({ manifest: manifest(wrongTenant), origin, tenantId }),
    'render_asset_same_origin_signature_invalid',
  );
  await rejectsCode(
    validateRenderManifestAssets({ manifest: manifest('file:///etc/passwd'), origin, tenantId }),
    'render_asset_protocol_forbidden',
  );
  await rejectsCode(
    validateRenderManifestAssets({ manifest: manifest('https://attacker.example/video.mp4'), origin, tenantId }),
    'render_asset_external_url_forbidden',
  );
  await rejectsCode(
    validateRenderManifestAssets({ manifest: manifest('data:text/html;base64,PGgxPk5PUEU8L2gxPg=='), origin, tenantId }),
    'render_asset_data_mime_forbidden',
  );

  const objectKey = 'studio-assets/tenants/tenant-render-policy/video.mp4';
  const signedObjectUrl = `https://objects.example.test/bucket/${objectKey}?X-Amz-Signature=test&X-Amz-Credential=test`;
  await validateRenderManifestAssets({
    manifest: manifest(signedObjectUrl),
    origin,
    tenantId,
    objectStorageOrigin: 'https://objects.example.test',
    allowedObjectKeys: [objectKey],
    resolveHostname: async () => ['8.8.8.8'],
  });
  await rejectsCode(validateRenderManifestAssets({
    manifest: manifest(signedObjectUrl),
    origin,
    tenantId,
    objectStorageOrigin: 'https://objects.example.test',
    allowedObjectKeys: ['another/key.mp4'],
    resolveHostname: async () => ['8.8.8.8'],
  }), 'render_asset_external_url_forbidden');

  const privateObjectUrl = `https://127.0.0.1:9000/bucket/${objectKey}?X-Amz-Signature=test&X-Amz-Credential=test`;
  await rejectsCode(validateRenderManifestAssets({
    manifest: manifest(privateObjectUrl),
    origin,
    tenantId,
    objectStorageOrigin: 'https://127.0.0.1:9000',
    allowedObjectKeys: [objectKey],
  }), 'render_asset_private_network_forbidden');

  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '::1', 'fd00::1', 'fe80::1', '::ffff:7f00:1']) {
    assert.equal(isPrivateOrReservedAddress(address), true, `${address} must be blocked`);
  }
  assert.equal(isPrivateOrReservedAddress('8.8.8.8'), false);
  assert.equal(isPrivateOrReservedAddress('2606:4700:4700::1111'), false);

  console.log('render asset SSRF policy regression passed');
} finally {
  if (previousSecret === undefined) delete process.env.ASSET_ACCESS_SECRET;
  else process.env.ASSET_ACCESS_SECRET = previousSecret;
}
