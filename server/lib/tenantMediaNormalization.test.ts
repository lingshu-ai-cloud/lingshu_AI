import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { normalizeTenantMedia } from './tenantMediaNormalization.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-media-normalization-'));
try {
  const source = await sharp({ create: { width: 37, height: 23, channels: 3, background: '#235599' } })
    .png().withMetadata({ comment: 'untrusted upload metadata' } as any).toBuffer();
  const normalized = await normalizeTenantMedia({
    buffer: source, originalName: 'factory.png', declaredMimeType: 'image/gif', kind: 'image', temporaryDirectory: directory,
  });
  assert.equal(normalized.mimeType, 'image/jpeg', 'actual decoded pixels decide the standard MIME');
  assert.equal(normalized.filename, 'factory.jpg');
  assert.equal(normalized.width, 37);
  assert.equal(normalized.height, 23);
  assert.equal(normalized.duration, 0);
  assert.equal(normalized.sha256.length, 64);
  assert.equal(normalized.normalization.metadataStripped, true);
  assert.deepEqual((await sharp(normalized.buffer).metadata()).comments, undefined);
  assert.deepEqual(normalized.poster?.buffer, normalized.buffer);

  await assert.rejects(() => normalizeTenantMedia({
    buffer: Buffer.from('not an image'), originalName: 'fake.jpg', declaredMimeType: 'image/jpeg', kind: 'image', temporaryDirectory: directory,
  }), /invalid/);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

console.log('tenant media normalization tests passed');
