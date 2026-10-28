import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { upsertLocalEnterpriseMaterial } from './enterpriseLocalMaterial.js';

test('profile save can bind an earlier uploaded image without stealing another product hash', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-product-binding-'));
  const before = process.env.MATERIAL_LIBRARY_FILE;
  process.env.MATERIAL_LIBRARY_FILE = path.join(dir, 'materials.json');
  try {
    const base = { tenantId: 'tenant-a', title: '产品图', type: 'image' as const, sizeBytes: 3,
      sha256: 'a'.repeat(64), sourceUrl: '/api/overseas/enterprise/assets/image.png',
      sourceName: 'image.png', provenance: {} };
    const uploaded = upsertLocalEnterpriseMaterial(base);
    assert.equal(uploaded.productId, undefined);
    const bound = upsertLocalEnterpriseMaterial({ ...base, productId: 'product-a', objectKey: 'enterprise-assets/tenant-a/image.png' });
    assert.equal(bound.id, uploaded.id);
    assert.equal(bound.productId, 'product-a');
    assert.throws(() => upsertLocalEnterpriseMaterial({ ...base, productId: 'product-b' }), /hash_product_conflict/);
  } finally {
    if (before === undefined) delete process.env.MATERIAL_LIBRARY_FILE;
    else process.env.MATERIAL_LIBRARY_FILE = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
