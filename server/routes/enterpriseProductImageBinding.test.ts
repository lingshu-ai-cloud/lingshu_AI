import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { upsertLocalEnterpriseMaterial } from './enterprise.js';

test('enterprise material same-hash import cannot reassign a different product', () => {
  const original = process.env.MATERIAL_LIBRARY_FILE;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'enterprise-product-binding-'));
  process.env.MATERIAL_LIBRARY_FILE = path.join(directory, 'materials.json');
  try {
    const common = { tenantId: 'tenant-a', title: 'catalog.png', type: 'image' as const,
      sizeBytes: 100, sha256: 'a'.repeat(64), sourceUrl: '/api/overseas/enterprise/assets/first.png',
      sourceName: 'catalog.png', provenance: { sourcePdfPage: 22 } };
    const first = upsertLocalEnterpriseMaterial({ ...common, productId: 'product-a' });
    const same = upsertLocalEnterpriseMaterial({ ...common, productId: 'product-a',
      sourceUrl: '/api/overseas/enterprise/assets/repeated.png', provenance: { changed: true } });
    assert.equal(same.id, first.id);
    assert.equal(same.sourceUrl, first.sourceUrl, 'same-product replay must not overwrite source URL');
    assert.deepEqual(same.provenance, first.provenance, 'same-product replay must not overwrite provenance');
    const legacy = upsertLocalEnterpriseMaterial({ ...common,
      sourceUrl: '/api/overseas/enterprise/assets/legacy-repeat.png', provenance: { changed: true } });
    assert.equal(legacy.sourceUrl, first.sourceUrl, 'old uploads must not overwrite an owned product binding');
    assert.throws(() => upsertLocalEnterpriseMaterial({ ...common, productId: 'product-b' }),
      /enterprise_product_image_hash_product_conflict/);
    const rows = JSON.parse(fs.readFileSync(process.env.MATERIAL_LIBRARY_FILE, 'utf8'));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].productId, 'product-a');
    assert.equal(rows[0].sourceUrl, '/api/overseas/enterprise/assets/first.png');
  } finally {
    if (original === undefined) delete process.env.MATERIAL_LIBRARY_FILE;
    else process.env.MATERIAL_LIBRARY_FILE = original;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
