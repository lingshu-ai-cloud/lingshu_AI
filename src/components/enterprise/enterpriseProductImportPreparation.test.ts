import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareEnterpriseProductImport, remoteProductImageTransfers, removePendingImportedProduct, type PendingProductImport } from './enterpriseProductImportPreparation.js';

const concat = (...parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
};
const u16 = (value: number) => new Uint8Array([value & 255, (value >>> 8) & 255]);
const u32 = (value: number) => new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);
function docxFixture(xml: string): Uint8Array {
  const name = new TextEncoder().encode('word/document.xml');
  const data = new TextEncoder().encode(xml);
  const local = concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(0), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data);
  const central = concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(0), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(0), name);
  return concat(local, central, u32(0x06054b50), u16(0), u16(0), u16(1), u16(1), u32(central.length), u32(local.length), u16(0));
}

test('CSV 导入保留类别、有效产品行和外链主图待转存状态', async () => {
  const file = new File(['商品名称,SKU,图片URL\n验收面霜,QA-1,https://example.invalid/cream.jpg\n,,\n'], 'products.csv', { type: 'text/csv' });
  const { pending, message } = await prepareEnterpriseProductImport(file, '美妆个护');
  assert.equal(pending.products.length, 1);
  assert.equal(pending.products[0]?.name, '验收面霜');
  assert.equal(pending.products[0]?.category, '美妆个护');
  assert.equal(pending.skippedRows, 0, '表格预处理已去掉的空行不计为无效产品行');
  assert.deepEqual(pending.remoteImageTransfers, { 0: { status: 'pending', originalUrl: 'https://example.invalid/cream.jpg' } });
  assert.match(message, /已解析 1 个产品/);
});

test('租户资产主图不会当成外链再次转存', () => {
  assert.deepEqual(remoteProductImageTransfers([
    { name: '租户图', imageUrl: '/api/overseas/enterprise/assets/asset-1' },
    { name: '外链图', imageUrl: 'https://example.invalid/photo.jpg' },
  ]), { 1: { status: 'pending', originalUrl: 'https://example.invalid/photo.jpg' } });
});

test('DOCX 表格进入同一产品确认草稿，不直接提交企业资料', async () => {
  const xml = '<w:document><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>产品名称</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>SKU</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>面霜</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>A-1</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
  const file = new File([docxFixture(xml)], 'products.docx');
  const { pending, message } = await prepareEnterpriseProductImport(file, '美妆个护');
  assert.equal(pending.products[0]?.name, '面霜');
  assert.equal(pending.products[0]?.sku, 'A-1');
  assert.equal(pending.products[0]?.category, '美妆个护');
  assert.equal(pending.sheetName, '文档正文');
  assert.deepEqual(pending.remoteImageTransfers, {});
  assert.match(message, /请确认字段与图片归属后导入/);
});

test('移除确认草稿中的产品时，图片归属与远端主图索引一起重排', () => {
  const file = new File(['image'], 'product.png', { type: 'image/png' });
  const pending: PendingProductImport = {
    fileName: 'products.pdf', sheetName: '文档正文', sourceLabel: '文档提取', totalRows: 3, skippedRows: 0,
    products: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
    assignedImages: [
      { productIndex: 0, name: 'a.png', url: 'blob:a', file },
      { productIndex: 1, name: 'b.png', url: 'blob:b', file },
      { productIndex: 2, name: 'c.png', url: 'blob:c', file },
    ],
    unassignedImages: [{ name: 'unknown.png', url: 'blob:unknown', file }],
    remoteImageTransfers: {
      0: { status: 'uploaded', originalUrl: 'https://example.invalid/a.png' },
      1: { status: 'pending', originalUrl: 'https://example.invalid/b.png' },
      2: { status: 'failed', originalUrl: 'https://example.invalid/c.png', error: 'transfer failed' },
    },
  };
  const next = removePendingImportedProduct(pending, 1);
  assert.deepEqual(next.products.map(item => item.name), ['A', 'C']);
  assert.deepEqual(next.assignedImages.map(item => [item.name, item.productIndex]), [['a.png', 0], ['c.png', 1]]);
  assert.deepEqual(Object.keys(next.remoteImageTransfers), ['0', '1']);
  assert.equal(next.remoteImageTransfers[1]?.originalUrl, 'https://example.invalid/c.png');
  assert.equal(next.remoteImageTransfers[1]?.status, 'failed');
  assert.equal(next.unassignedImages, pending.unassignedImages);
  assert.equal(pending.products.length, 3);
  assert.equal(removePendingImportedProduct(pending, 3), pending);
});
