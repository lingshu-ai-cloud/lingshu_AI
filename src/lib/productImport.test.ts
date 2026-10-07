import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { heuristicProductMapping, mapRowToProduct, parseWorkbook, prepareSheet } from './productImport.js';

function sampleXlsx(): File {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['SKU', '商品名称'],
    ['A-01', '铝合金支架'],
  ]), '产品');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true });
  return new File([bytes], 'products.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

test('安全解析 CSV：支持引号、逗号和换行', async () => {
  const file = new File([
    '\uFEFFSKU,商品名称,卖点\r\nA-01,"铝合金,支架","第一行\n第二行"\r\n',
  ], 'products.csv', { type: 'text/csv' });
  const sheets = await parseWorkbook(file);
  assert.equal(sheets.length, 1);
  assert.deepEqual(sheets[0]?.rows, [
    ['SKU', '商品名称', '卖点'],
    ['A-01', '铝合金,支架', '第一行\n第二行'],
  ]);
});

test('只有一条产品数据时不会把产品行误判为第二行表头', async () => {
  const csv = '产品名称,SKU,品牌,卖点\n验收面霜,QA-1,灵枢测试,保湿';
  const [sheet] = await parseWorkbook(new File([csv], 'single-product.csv', { type: 'text/csv' }));
  const prepared = prepareSheet(sheet);
  const mapping = heuristicProductMapping(prepared.headers);
  const products = prepared.dataRows.map(row => mapRowToProduct(row, mapping));
  assert.equal(products.length, 1);
  assert.equal(products[0]?.name, '验收面霜');
  assert.equal(products[0]?.sku, 'QA-1');
});

test('使用受限安全解析器读取真实 xlsx 工作簿', async () => {
  const sheets = await parseWorkbook(sampleXlsx());
  assert.deepEqual(sheets, [{
    name: '产品',
    rows: [['SKU', '商品名称'], ['A-01', '铝合金支架']],
    rowCount: 2,
  }]);
});

test('拒绝伪装的 xls 和超大产品表', async () => {
  await assert.rejects(
    () => parseWorkbook(new File(['legacy'], 'products.xls')),
    /扩展名与文件内容不匹配/,
  );
  const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'products.xlsx');
  await assert.rejects(() => parseWorkbook(oversized), /不能超过 10 MB/);
});

test('拒绝畸形 CSV 和不支持的扩展名', async () => {
  await assert.rejects(
    () => parseWorkbook(new File(['sku,name\n1,"broken'], 'products.csv')),
    /未闭合的引号/,
  );
  await assert.rejects(
    () => parseWorkbook(new File(['data'], 'products.json')),
    /仅支持/,
  );
});
