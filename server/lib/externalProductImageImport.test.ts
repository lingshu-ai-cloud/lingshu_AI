import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { downloadAndNormalizeExternalImage, ExternalImageImportError, isPublicInternetAddress } from './externalProductImageImport.js';

assert.equal(isPublicInternetAddress('127.0.0.1'), false);
assert.equal(isPublicInternetAddress('10.0.0.8'), false);
assert.equal(isPublicInternetAddress('169.254.169.254'), false);
assert.equal(isPublicInternetAddress('::1'), false);
assert.equal(isPublicInternetAddress('8.8.8.8'), true);

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'external-image-import-'));
const publicDns = async () => [{ address: '8.8.8.8', family: 4 }];
try {
  await assert.rejects(() => downloadAndNormalizeExternalImage({ url: 'https://private.example/a.jpg', temporaryDirectory: directory,
    resolve: async () => [{ address: '10.1.2.3', family: 4 }], fetcher: async () => { throw new Error('must not fetch'); } }),
  (error: unknown) => error instanceof ExternalImageImportError && error.code === 'UNSAFE_ADDRESS');

  const redirectHosts: string[] = [];
  await assert.rejects(() => downloadAndNormalizeExternalImage({ url: 'https://public.example/a.jpg', temporaryDirectory: directory,
    resolve: async host => { redirectHosts.push(host); return host === 'internal.example' ? [{ address: '127.0.0.1', family: 4 }] : publicDns(); },
    fetcher: async () => new Response(null, { status: 302, headers: { location: 'https://internal.example/secret.jpg' } }) }),
  (error: unknown) => error instanceof ExternalImageImportError && error.code === 'UNSAFE_ADDRESS');
  assert.deepEqual(redirectHosts, ['public.example', 'internal.example']);

  await assert.rejects(() => downloadAndNormalizeExternalImage({ url: 'https://public.example/fake.jpg', temporaryDirectory: directory,
    resolve: publicDns, fetcher: async () => new Response('not-image', { status: 200, headers: { 'content-type': 'image/jpeg' } }) }),
  (error: unknown) => error instanceof ExternalImageImportError && error.code === 'INVALID_IMAGE');

  const image = await sharp({ create: { width: 41, height: 29, channels: 3, background: '#336699' } }).png().toBuffer();
  const result = await downloadAndNormalizeExternalImage({ url: 'https://cdn.example/products/item.png', temporaryDirectory: directory,
    resolve: publicDns, fetcher: async () => new Response(image, { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(image.length) } }) });
  assert.equal(result.width, 41);
  assert.equal(result.height, 29);
  assert.equal(result.mimeType, 'image/jpeg');
  assert.equal(result.sha256.length, 64);
  assert.equal(result.sourceUrl, 'https://cdn.example/products/item.png');
} finally { fs.rmSync(directory, { recursive: true, force: true }); }

console.log('external product image import security tests passed');
