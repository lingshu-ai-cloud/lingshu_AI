import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createGeneratedImageMaterial } from './generatedImageMaterial.js';
import { readLocalMaterials } from './materialLibrary.js';
import { objectStorageDownload, objectStorageUpload } from '../storage/objectStorage.js';

test('generated image writer persists tenant-owned PNG and GIF through the same material contract', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-image-material-'));
  const previousLibrary = process.env.MATERIAL_LIBRARY_FILE;
  const previousObjectRoot = process.env.LOCAL_OBJECT_STORAGE_ROOT;
  const previousDriver = process.env.OBJECT_STORAGE_DRIVER;
  process.env.MATERIAL_LIBRARY_FILE = path.join(directory, 'materials.json');
  process.env.LOCAL_OBJECT_STORAGE_ROOT = path.join(directory, 'object-storage');
  process.env.OBJECT_STORAGE_DRIVER = 'local';
  try {
    for (const [mimeType, extension] of [['image/png', 'png'], ['image/gif', 'gif']] as const) {
      const bytes = await sharp({ create: { width: 12, height: 15, channels: 4, background: '#123456' } })
        .toFormat(extension).toBuffer();
      const input = {
        title: `Generated ${extension}`, bytes, mimeType, source: extension === 'gif' ? 'deterministic-compositor' : 'openai',
        tenantId: 'tenant-a', sourceType: 'ai_generated_marketing_image',
        provenance: { socialImageTaskId: 'task-a', socialImageJobId: `job-${extension}` },
        mediaRoot: path.join(directory, 'media'),
        ...(extension === 'gif' ? { stableKey: 'task-a:plan-1:gif-output' } : {}),
      };
      const material = await createGeneratedImageMaterial(input);
      assert.match(material.file, new RegExp(`^tenants/tenant-a/[a-f0-9-]+\\.${extension}$`));
      assert.equal(material.contentSha256, createHash('sha256').update(bytes).digest('hex'));
      assert.equal(material.width, 12);
      assert.equal(material.height, 15);
      assert.equal(material.provenance.socialImageTaskId, 'task-a');
      assert.equal(material.url, '');
      assert.ok(material.objectKey);
      assert.equal(readLocalMaterials().find(item => item.id === material.id)?.contentSha256, material.contentSha256);
      const stored = await objectStorageDownload(material.objectKey!);
      assert.deepEqual(stored?.buf, bytes);
      if (extension === 'gif') {
        assert.match(material.id, /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
        const repeated = await createGeneratedImageMaterial(input);
        assert.equal(repeated.id, material.id);
        assert.equal(readLocalMaterials().filter(item => item.id === material.id).length, 1);
        await assert.rejects(createGeneratedImageMaterial({ ...input, bytes: Buffer.from('different') }), /generated_image_material_identity_conflict/);
        await objectStorageUpload({ key: material.objectKey!, body: Buffer.from('corrupt'), contentType: mimeType });
        await assert.rejects(createGeneratedImageMaterial(input), /generated_image_material_bytes_conflict/);
      }
    }
  } finally {
    if (previousLibrary === undefined) delete process.env.MATERIAL_LIBRARY_FILE; else process.env.MATERIAL_LIBRARY_FILE = previousLibrary;
    if (previousObjectRoot === undefined) delete process.env.LOCAL_OBJECT_STORAGE_ROOT; else process.env.LOCAL_OBJECT_STORAGE_ROOT = previousObjectRoot;
    if (previousDriver === undefined) delete process.env.OBJECT_STORAGE_DRIVER; else process.env.OBJECT_STORAGE_DRIVER = previousDriver;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
