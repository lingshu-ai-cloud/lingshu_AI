import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { unifiedPublishPreflight } from './unifiedPublishPreflight.js';

test('unified preflight accepts one canonical caption and at most five tags', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-preflight-'));
  const image = path.join(directory, 'product.jpg');
  fs.writeFileSync(image, Buffer.alloc(1_024));
  try {
    const accepted = unifiedPublishPreflight({ platform: 'linkedin', title: 'Product', description: 'Verified product proof.', tags: ['OEM', '#factory'], imagePaths: [image] });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.mediaKind, 'image');
    assert.deepEqual(accepted.normalizedTags, ['OEM', 'factory']);
    const rejected = unifiedPublishPreflight({ platform: 'facebook', title: 'Product', description: 'Proof', tags: ['1', '2', '3', '4', '5', '6'], imagePaths: [image] });
    assert.equal(rejected.ok, false);
    assert.match(rejected.errors.join(';'), /最多 5 个/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
