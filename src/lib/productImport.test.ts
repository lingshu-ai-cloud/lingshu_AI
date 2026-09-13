import test from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { parseWorkbook } from './productImport.js';

function sampleXlsx(): File {
  const archive = zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="产品" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8('<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>SKU</t></is></c><c r="B1" t="inlineStr"><is><t>商品名称</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>A-01</t></is></c><c r="B2" t="inlineStr"><is><t>铝合金支架</t></is></c></row></sheetData></worksheet>'),
  });
  const buffer = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
  return new File([buffer], 'products.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
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

test('使用替代解析器读取真实 xlsx 工作簿', async () => {
  const sheets = await parseWorkbook(sampleXlsx());
  assert.deepEqual(sheets, [{
    name: '产品',
    rows: [['SKU', '商品名称'], ['A-01', '铝合金支架']],
    rowCount: 2,
  }]);
});

test('拒绝旧式 xls 和超大产品表', async () => {
  await assert.rejects(
    () => parseWorkbook(new File(['legacy'], 'products.xls')),
    /旧版 \.xls 已停用/,
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
    /仅支持 \.xlsx 或 \.csv/,
  );
});
