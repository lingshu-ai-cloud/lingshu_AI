import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveTenantRenderOutput } from './renderOutputPolicy.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'render-output-policy-'));
const tenantDir = path.join(root, 'tenant-a');
const otherDir = path.join(root, 'tenant-b');
fs.mkdirSync(tenantDir);
fs.mkdirSync(otherDir);
const owned = path.join(tenantDir, 'owned.mp4');
const other = path.join(otherDir, 'other.mp4');
const wrongType = path.join(tenantDir, 'notes.txt');
fs.writeFileSync(owned, 'owned');
fs.writeFileSync(other, 'other');
fs.writeFileSync(wrongType, 'not video');

try {
  assert.deepEqual(resolveTenantRenderOutput(tenantDir, owned), { ok: true, filePath: fs.realpathSync(owned) });
  assert.deepEqual(resolveTenantRenderOutput(tenantDir, other), { ok: false, reason: 'forbidden' });
  assert.deepEqual(resolveTenantRenderOutput(tenantDir, wrongType), { ok: false, reason: 'forbidden' });
  assert.deepEqual(resolveTenantRenderOutput(tenantDir, path.join(tenantDir, 'missing.mp4')), { ok: false, reason: 'missing' });
  if (process.platform !== 'win32') {
    const symlink = path.join(tenantDir, 'linked.mp4');
    fs.symlinkSync(other, symlink);
    assert.deepEqual(resolveTenantRenderOutput(tenantDir, symlink), { ok: false, reason: 'forbidden' });
  }
  console.log('tenant render output boundary regression passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
