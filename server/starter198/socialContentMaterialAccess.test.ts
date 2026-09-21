import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import { cloudMaterialView } from '../lib/cloudMaterials.js';
import type { MaterialRecord } from '../lib/materialLibrary.js';
import {
  materializeSocialContentCloudMaterial,
  socialContentCloudMaterialRecordId,
  type SocialContentCloudMaterialPort,
} from './socialContentMaterialAccess.js';
import { resolveTaskProductionMaterialLocation } from './socialContentAutoProduction.js';
import { withSocialContentRenderWorkspace } from './socialContentRenderWorkspace.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const SHA256 = createHash('sha256').update(PNG).digest('hex');
const RECORD_ID = 'abcdefghijklmno';

const cloudView = cloudMaterialView({
  id: RECORD_ID,
  tenantId: 'tenant-a',
  title: '产品实拍',
  type: 'image',
  videoFile: 'product.png',
  sha256: SHA256,
});
assert.equal(cloudView.id, `pb-${RECORD_ID}`);
assert.equal(cloudView.cloudRecordId, RECORD_ID);

function record(overrides: Partial<MaterialRecord> = {}): MaterialRecord {
  return {
    id: `pb-${RECORD_ID}`,
    cloudRecordId: RECORD_ID,
    name: '产品实拍.png',
    file: 'product.png',
    type: 'image',
    sizeBytes: PNG.length,
    contentSha256: SHA256,
    // This metadata is deliberately hostile. Production must use the injected
    // tenant-aware backend port, never this URL.
    url: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    ...overrides,
  } as MaterialRecord;
}

function pngResponse(): Response {
  return new Response(PNG, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(PNG.length),
    },
  });
}

assert.equal(socialContentCloudMaterialRecordId(record()), RECORD_ID);
assert.equal(socialContentCloudMaterialRecordId(record({ cloudRecordId: 'ponmlkjihgfedcb' })), '');
assert.equal(socialContentCloudMaterialRecordId(record({ id: 'pb-not-a-pocketbase-id' })), '');

const calls: Array<{ tenantId: string; recordId: string }> = [];
const tenantPort: SocialContentCloudMaterialPort = {
  fetch: async input => {
    calls.push(input);
    return input.tenantId === 'tenant-a' && input.recordId === RECORD_ID ? pngResponse() : null;
  },
};

let materializedPath = '';
await withSocialContentRenderWorkspace(async outputDirectory => {
  const result = await resolveTaskProductionMaterialLocation({
    tenantId: 'tenant-a',
    record: record(),
    type: 'image',
    outputDirectory,
    index: 0,
    cloudMaterialPort: tenantPort,
  });
  materializedPath = result.localPath || '';
  assert.deepEqual(calls, [{ tenantId: 'tenant-a', recordId: RECORD_ID }]);
  assert.equal(result.cloudRecordId, RECORD_ID);
  assert.equal(result.sha256, SHA256);
  assert.deepEqual(await fsp.readFile(materializedPath), PNG);
  assert.equal((await fsp.stat(materializedPath)).mode & 0o777, 0o600);
});
await assert.rejects(() => fsp.stat(materializedPath), { code: 'ENOENT' });

// Tenant context must reach the backend port. An inaccessible record fails
// closed and never falls back to the record's public/relative URL.
await withSocialContentRenderWorkspace(async outputDirectory => {
  await assert.rejects(
    () => resolveTaskProductionMaterialLocation({
      tenantId: 'tenant-b',
      record: record(),
      type: 'image',
      outputDirectory,
      index: 0,
      cloudMaterialPort: tenantPort,
    }),
    (error: unknown) => (error as { code?: string }).code === 'social_content_material_unavailable',
  );
});
assert.deepEqual(calls.at(-1), { tenantId: 'tenant-b', recordId: RECORD_ID });

// A conflicting identity is rejected before any backend read, even when an
// attacker supplies an SSRF target in URL metadata.
let mismatchPortCalled = false;
await withSocialContentRenderWorkspace(async outputDirectory => {
  await assert.rejects(
    () => resolveTaskProductionMaterialLocation({
      tenantId: 'tenant-a',
      record: record({ cloudRecordId: 'ponmlkjihgfedcb' }),
      type: 'image',
      outputDirectory,
      index: 0,
      cloudMaterialPort: { fetch: async () => { mismatchPortCalled = true; return pngResponse(); } },
    }),
    (error: unknown) => (error as { code?: string }).code === 'social_content_material_identity_invalid',
  );
});
assert.equal(mismatchPortCalled, false);

// Non-cloud inventory rows cannot turn arbitrary http(s) URLs into renderer
// inputs. They must first be imported into tenant-owned storage.
await withSocialContentRenderWorkspace(async outputDirectory => {
  for (const url of [
    'http://127.0.0.1:8090/api/admins',
    `/studio-media/${RECORD_ID}/media.mp4`,
  ]) {
    const result = await resolveTaskProductionMaterialLocation({
      tenantId: 'tenant-a',
      record: { id: 'legacy-material', type: 'image', url, file: 'missing.png' },
      type: 'image',
      outputDirectory,
      index: 1,
      cloudMaterialPort: { fetch: async () => { throw new Error('must not fetch'); } },
    });
    assert.deepEqual(result, { url: '' });
  }
});

// Integrity failures erase the partially materialized file immediately; the
// workspace finally then removes the enclosing directory as well.
let integrityDirectory = '';
await withSocialContentRenderWorkspace(async outputDirectory => {
  integrityDirectory = outputDirectory;
  await assert.rejects(
    () => materializeSocialContentCloudMaterial({
      tenantId: 'tenant-a',
      record: record({ contentSha256: '0'.repeat(64) }),
      type: 'image',
      outputDirectory,
      index: 2,
      port: tenantPort,
    }),
    (error: unknown) => (error as { code?: string }).code === 'social_content_material_integrity_violation',
  );
  assert.deepEqual(await fsp.readdir(outputDirectory), []);
});
await assert.rejects(() => fsp.stat(integrityDirectory), { code: 'ENOENT' });

console.log('social content material access tests passed');
