import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseWorkbook, PRODUCT_IMPORT_LIMITS } from './productImport.js';

function workbookFile(bookType: 'xls' | 'xlsx', rows: unknown[][], configure?: (sheet: XLSX.WorkSheet) => void): File {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  configure?.(sheet);
  XLSX.utils.book_append_sheet(workbook, sheet, '产品');
  const bytes = XLSX.write(workbook, { type: 'array', bookType, compression: true });
  return new File([bytes], `products.${bookType}`);
}

function declaredExpansionBomb(uncompressedBytes: number): File {
  const name = new TextEncoder().encode('xl/worksheets/sheet1.xml');
  const localHeaderBytes = 30 + name.length;
  const compressedBytes = 1;
  const centralOffset = localHeaderBytes + compressedBytes;
  const centralBytes = 46 + name.length;
  const eocdOffset = centralOffset + centralBytes;
  const bytes = new Uint8Array(eocdOffset + 22);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(8, 8, true);
  view.setUint32(18, compressedBytes, true);
  view.setUint32(22, uncompressedBytes, true);
  view.setUint16(26, name.length, true);
  bytes.set(name, 30);

  view.setUint32(centralOffset, 0x02014b50, true);
  view.setUint16(centralOffset + 4, 20, true);
  view.setUint16(centralOffset + 6, 20, true);
  view.setUint16(centralOffset + 10, 8, true);
  view.setUint32(centralOffset + 20, compressedBytes, true);
  view.setUint32(centralOffset + 24, uncompressedBytes, true);
  view.setUint16(centralOffset + 28, name.length, true);
  bytes.set(name, centralOffset + 46);

  view.setUint32(eocdOffset, 0x06054b50, true);
  view.setUint16(eocdOffset + 8, 1, true);
  view.setUint16(eocdOffset + 10, 1, true);
  view.setUint32(eocdOffset + 12, centralBytes, true);
  view.setUint32(eocdOffset + 16, centralOffset, true);
  return new File([bytes], 'bomb.xlsx');
}

assert.equal(XLSX.version, '0.20.3', 'imports must use the vendored patched SheetJS release');

const csv = await parseWorkbook(new File([
  'SKU,产品名称,材质\r\nA-1,针织衫,棉\r\n',
], 'products.csv', { type: 'text/csv' }));
assert.deepEqual(csv[0]?.rows, [
  ['SKU', '产品名称', '材质'],
  ['A-1', '针织衫', '棉'],
]);

for (const bookType of ['xlsx', 'xls'] as const) {
  const parsed = await parseWorkbook(workbookFile(bookType, [
    ['SKU', '产品名称'],
    ['A-2', '冲锋衣'],
  ]));
  assert.deepEqual(parsed[0]?.rows, [
    ['SKU', '产品名称'],
    ['A-2', '冲锋衣'],
  ], `${bookType} behavior must remain compatible`);
}

let oversizedRead = false;
const oversized = {
  name: 'oversized.xlsx',
  size: PRODUCT_IMPORT_LIMITS.maxFileBytes + 1,
  arrayBuffer: async () => {
    oversizedRead = true;
    return new ArrayBuffer(0);
  },
} as File;
await assert.rejects(parseWorkbook(oversized), /文件不能超过 10 MB/);
assert.equal(oversizedRead, false, 'oversized files must be rejected before allocating their buffers');

await assert.rejects(
  parseWorkbook(new File(['not a zip'], 'disguised.xlsx')),
  /扩展名与文件内容不匹配/,
);
await assert.rejects(
  parseWorkbook(new File(['not an OLE workbook'], 'disguised.xls')),
  /扩展名与文件内容不匹配/,
);
await assert.rejects(
  parseWorkbook(new File(['sku,name'], 'products.txt')),
  /仅支持 \.csv、\.xls 和 \.xlsx/,
);
await assert.rejects(
  parseWorkbook(declaredExpansionBomb(PRODUCT_IMPORT_LIMITS.maxArchiveEntryBytes + 1)),
  /单项展开后不能超过 32 MB/,
);

const excessiveRows = Array.from(
  { length: PRODUCT_IMPORT_LIMITS.maxRowsPerSheet + 1 },
  (_, index) => `${index},产品${index}`,
).join('\n');
await assert.rejects(
  parseWorkbook(new File([`SKU,产品名称\n${excessiveRows}`], 'too-many-rows.csv')),
  /不能超过 20000 行/,
);

const excessiveColumns = Array.from(
  { length: PRODUCT_IMPORT_LIMITS.maxColumnsPerSheet + 1 },
  (_, index) => `字段${index}`,
).join(',');
await assert.rejects(
  parseWorkbook(new File([excessiveColumns], 'too-many-columns.csv')),
  /不能超过 256 列/,
);

await assert.rejects(
  parseWorkbook(workbookFile('xlsx', [['合并标题']], sheet => {
    sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 250, c: 199 } }];
  })),
  /合并单元格展开后不能超过 50000 个/,
);

await assert.rejects(
  parseWorkbook(new File([
    `SKU,产品名称\nA-3,${'x'.repeat(PRODUCT_IMPORT_LIMITS.maxCellTextLength + 1)}`,
  ], 'oversized-cell.csv')),
  /超过 32767 字符的单元格/,
);

console.log('product import security fixtures passed');
