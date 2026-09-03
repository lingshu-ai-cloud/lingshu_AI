import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { heuristicProductMapping, parseWorkbook, prepareSheet } from './productImport.js';

function inputFile(bytes: BlobPart[], name: string, type: string): File {
  return new File(bytes, name, { type });
}

const csv = '\uFEFF说明行,,\n货号,商品名称,零售价\nSKU-001,"连衣裙, 夏季",199.00\n';
const csvSheets = await parseWorkbook(inputFile([csv], 'products.csv', 'text/csv'));
const preparedCsv = prepareSheet(csvSheets[0]!);
assert.equal(preparedCsv.headerRowIndex, 1);
assert.deepEqual(preparedCsv.headers, ['货号', '商品名称', '零售价']);
assert.equal(preparedCsv.dataRows[0]?.['商品名称'], '连衣裙, 夏季');
assert.deepEqual(heuristicProductMapping(preparedCsv.headers), {
  货号: 'sku',
  商品名称: 'name',
  零售价: 'retailPrice',
});

const workbook = XLSX.utils.book_new();
const sheet = XLSX.utils.aoa_to_sheet([
  ['产品资料', '', ''],
  ['SKU', 'Name', 'Price'],
  ['A-100', 'Cotton Shirt', 29.5],
]);
sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }];
XLSX.utils.book_append_sheet(workbook, sheet, 'Products');
const xlsxBytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
const xlsxSheets = await parseWorkbook(inputFile([xlsxBytes], 'products.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
assert.equal(xlsxSheets[0]?.name, 'Products');
const preparedXlsx = prepareSheet(xlsxSheets[0]!, 1);
assert.equal(preparedXlsx.dataRows[0]?.SKU, 'A-100');
assert.equal(preparedXlsx.dataRows[0]?.Price, '29.5');

console.log(`safe CSV and SheetJS ${XLSX.version} XLSX product imports passed`);
