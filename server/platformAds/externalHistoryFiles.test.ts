import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fingerprintHistoryFile, readHistoryImageMaterials } from './externalHistoryFiles.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'history-fingerprint-'));
try {
  const prefix = 'materials/tenants/dGVuYW50/', key = `${prefix}image.png`, bytes = Buffer.from('original-owned-bytes');
  fs.mkdirSync(path.dirname(path.join(root, key)), { recursive: true }); fs.writeFileSync(path.join(root, key), bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const input = { id: 'output', root, key, prefix, sha256, size: bytes.length };
  assert.equal((await fingerprintHistoryFile(input)).state, 'verified');
  assert.equal((await fingerprintHistoryFile({ ...input, sha256: undefined, size: undefined })).state, 'fingerprinted');
  assert.equal((await fingerprintHistoryFile({ ...input, sha256: 'a'.repeat(64) })).state, 'mismatch');
  assert.equal((await fingerprintHistoryFile({ ...input, size: bytes.length + 1 })).state, 'mismatch');
  assert.equal((await fingerprintHistoryFile({ ...input, key: `${prefix}missing.png` })).state, 'missing');
  assert.equal((await fingerprintHistoryFile({ ...input, key: `${prefix}../escape` })).state, 'unavailable');
  fs.writeFileSync(path.join(root, 'foreign.png'), bytes); fs.symlinkSync(path.join(root, 'foreign.png'), path.join(root, prefix, 'link.png'));
  assert.equal((await fingerprintHistoryFile({ ...input, key: `${prefix}link.png` })).state, 'unavailable');
  const materialsFile = path.join(root, 'materials.json');
  fs.writeFileSync(materialsFile, JSON.stringify([{ id: 'material', tenantId: 'tenant', objectKey: key, contentSha256: sha256, sizeBytes: bytes.length }]));
  assert.equal((await readHistoryImageMaterials({ objectRoot: root, materialsFile }, 'tenant', [{ id: 'out', materialId: 'material' }]))[0].state, 'verified');
  assert.equal((await readHistoryImageMaterials({ objectRoot: root, materialsFile }, 'other', [{ id: 'out', materialId: 'material' }]))[0].state, 'unavailable');
  console.log('Read-only file fingerprints: exact SHA/size, missing, unfrozen hashes, traversal, symlink and image-tenant isolation passed');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
