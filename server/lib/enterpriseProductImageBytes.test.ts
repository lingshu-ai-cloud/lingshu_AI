import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { readTenantProductImageBytes } from './enterpriseProductImageBytes.js';
import { enterpriseAssetObjectKey, enterpriseAssetTenantKey } from '../storage/enterpriseAssets.js';

test('product pipeline reads the same tenant catalog pixels and blocks foreign paths and symlinks', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'product-image-bytes-'));
  try {
    const bytes = await sharp({ create: { width: 12, height: 18, channels: 4, background: '#fff' } }).png().toBuffer();
    for (const tenant of ['a', 'b']) {
      fs.mkdirSync(path.join(root, 'tenants', tenant, 'catalog'), { recursive: true });
      fs.writeFileSync(path.join(root, 'tenants', tenant, 'catalog/product.png'), bytes);
    }
    fs.symlinkSync(path.join(root, 'tenants/b/catalog/product.png'), path.join(root, 'tenants/a/catalog/link.png'));
    let remoteReads = 0;
    const options = { mediaRoot: root, readObject: async () => { remoteReads++; return null; } };
    assert.deepEqual(await readTenantProductImageBytes('a', '/media/tenants/a/catalog/product.png', options), bytes);
    for (const url of ['/media/tenants/b/catalog/product.png', '/media/tenants/a/%2e%2e%2fb/catalog/product.png',
      'https://foreign.test/media/tenants/a/catalog/product.png', '/media/tenants/a/catalog/product.png?rewrite=1',
      '/media/tenants/a/catalog/link.png', '/media/tenants/a/catalog/missing.png']) {
      assert.equal(await readTenantProductImageBytes('a', url, options), null, url);
    }
    assert.equal(remoteReads, 0, 'invalid catalog paths never fall through to a remote request');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('enterprise uploads retain tenant-local and object-storage reads without accepting arbitrary URLs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enterprise-upload-bytes-'));
  try {
    const tenantRoot = path.join(root, enterpriseAssetTenantKey('a'));
    fs.mkdirSync(tenantRoot);
    fs.writeFileSync(path.join(tenantRoot, 'own.png'), 'own-image');
    fs.writeFileSync(path.join(root, 'foreign.png'), 'foreign-image');
    fs.symlinkSync(path.join(root, 'foreign.png'), path.join(tenantRoot, 'link.png'));
    const keys: string[] = [];
    const options = { enterpriseRoot: root, readObject: async (key: string) => { keys.push(key); return Buffer.from('stored-image'); } };
    assert.equal((await readTenantProductImageBytes('a', '/api/overseas/enterprise/assets/own.png', options))?.toString(), 'own-image');
    assert.equal((await readTenantProductImageBytes('a', '/api/overseas/enterprise/assets/stored.png', options))?.toString(), 'stored-image');
    assert.deepEqual(keys, [enterpriseAssetObjectKey('a', 'stored.png')]);
    for (const url of ['https://foreign.test/api/overseas/enterprise/assets/own.png',
      '/api/overseas/enterprise/assets/..%2Fforeign.png', '/api/overseas/enterprise/assets/link.png']) {
      assert.equal(await readTenantProductImageBytes('a', url, options), null);
    }
    assert.equal(keys.length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
