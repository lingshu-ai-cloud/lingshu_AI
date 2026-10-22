import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmEnterpriseProductImportAssets } from './enterpriseProductImportConfirmation.js';
import type { PendingProductImport } from './enterpriseProductImportPreparation.js';

const asset = (url: string) => ({ name: '图片', type: 'image/png', size: 1, updatedAt: '2026-10-22', url });
function pendingImport(): PendingProductImport {
  return {
    fileName: 'products.docx', sheetName: '文档正文', products: [{ name: '产品 A' }, { name: '产品 B', imageUrl: 'https://example.invalid/b.png', images: [asset('https://example.invalid/b.png')] }],
    totalRows: 2, skippedRows: 0, sourceLabel: '文档',
    assignedImages: [{ productIndex: 0, name: 'a.png', url: 'blob:a', file: new File(['a'], 'a.png', { type: 'image/png' }) }],
    unassignedImages: [{ name: 'unknown.png', url: 'blob:unknown', file: new File(['u'], 'unknown.png', { type: 'image/png' }) }],
    remoteImageTransfers: { 1: { status: 'pending', originalUrl: 'https://example.invalid/b.png' } },
  };
}

test('文档图片与外链主图均成功后才允许产品进入资料', async () => {
  const uploads: string[] = [];
  const progress: PendingProductImport[] = [];
  const result = await confirmEnterpriseProductImportAssets(pendingImport(), {
    upload: async file => { uploads.push(file.name); return asset(`/api/overseas/enterprise/assets/${file.name}`); },
    importUrl: async () => asset('/api/overseas/enterprise/assets/b.png'),
  }, current => progress.push(current));
  assert.equal(result.status, 'ready');
  assert.deepEqual(uploads, ['a.png', 'unknown.png']);
  assert.equal(result.pending.products[0]?.imageUrl, '/api/overseas/enterprise/assets/a.png');
  assert.equal(result.pending.products[1]?.imageUrl, '/api/overseas/enterprise/assets/b.png');
  assert.equal(result.pending.remoteImageTransfers[1]?.status, 'uploaded');
  assert.equal(result.pending.unassignedImages[0]?.status, 'uploaded');
  assert.ok(progress.length >= 3);
});

test('外链失败保留已上传图片回执，恢复时不重新上传已成功图片', async () => {
  const uploads: string[] = [];
  const first = await confirmEnterpriseProductImportAssets(pendingImport(), {
    upload: async file => { uploads.push(file.name); return asset(`/api/overseas/enterprise/assets/${file.name}`); },
    importUrl: async () => { throw new Error('外链暂不可用'); },
  });
  assert.equal(first.status, 'blocked');
  assert.equal(first.pending.assignedImages[0]?.uploadedUrl, '/api/overseas/enterprise/assets/a.png');
  assert.equal(first.pending.remoteImageTransfers[1]?.status, 'failed');
  assert.deepEqual(uploads, ['a.png']);
  const second = await confirmEnterpriseProductImportAssets(first.pending, {
    upload: async file => { uploads.push(file.name); return asset(`/api/overseas/enterprise/assets/${file.name}`); },
    importUrl: async () => asset('/api/overseas/enterprise/assets/b.png'),
  });
  assert.equal(second.status, 'ready');
  assert.deepEqual(uploads, ['a.png', 'unknown.png']);
  assert.equal(second.pending.products[0]?.images?.filter(image => image.url === '/api/overseas/enterprise/assets/a.png').length, 1);
});

test('未归属图片上传失败时阻止导入并保留失败项供核对', async () => {
  const result = await confirmEnterpriseProductImportAssets(pendingImport(), {
    upload: async file => { if (file.name === 'unknown.png') throw new Error('上传失败'); return asset('/api/overseas/enterprise/assets/a.png'); },
    importUrl: async () => asset('/api/overseas/enterprise/assets/b.png'),
  });
  assert.equal(result.status, 'blocked');
  if (result.status !== 'blocked') throw new Error('expected blocked import');
  assert.equal(result.pending.unassignedImages[0]?.status, 'failed');
  assert.match(result.message, /未归属图片上传失败，产品尚未导入/);
});
