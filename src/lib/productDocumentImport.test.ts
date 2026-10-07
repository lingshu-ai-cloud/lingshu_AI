import test from 'node:test';
import assert from 'node:assert/strict';
import { docxTablesFromXml, parseProductDocument, productsFromLabeledText } from './productDocumentImport.js';

const enc = new TextEncoder();
const concat = (...parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((sum, item) => sum + item.length, 0));
  let offset = 0;
  for (const item of parts) { result.set(item, offset); offset += item.length; }
  return result;
};
const u16 = (value: number) => new Uint8Array([value & 255, (value >>> 8) & 255]);
const u32 = (value: number) => new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);

function storedZip(files: Record<string, Uint8Array | string>): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, raw] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const data = typeof raw === 'string' ? enc.encode(raw) : raw;
    const local = concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(0), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes, data);
    locals.push(local);
    centrals.push(concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(0), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes));
    offset += local.length;
  }
  const directory = concat(...centrals);
  return concat(...locals, directory, u32(0x06054b50), u16(0), u16(0), u16(centrals.length), u16(centrals.length), u32(directory.length), u32(offset), u16(0));
}

test('从 PDF 风格标签文本提取结构化产品字段', () => {
  const products = productsFromLabeledText('产品名称：轻盈面霜\nSKU：CR-01\n品牌：Ling\n价格：99\n卖点：清爽保湿');
  assert.deepEqual(products, [{ name: '轻盈面霜', sku: 'CR-01', brand: 'Ling', color: undefined, size: undefined, retailPrice: '99', moq: undefined, material: undefined, imageUrl: undefined, highlights: '清爽保湿' }]);
  assert.deepEqual(productsFromLabeledText('第1页 产品名称：精华液 SKU：S-2 品牌：Ling 价格：128 卖点：提亮')[0], {
    name: '精华液', sku: 'S-2', brand: 'Ling', color: undefined, size: undefined, retailPrice: '128', moq: undefined, material: undefined, imageUrl: undefined, highlights: '提亮',
  });
});

test('DOCX 表格解析保留行列关系', () => {
  const xml = '<w:document><w:tbl><w:tr><w:tc><w:p><w:r><w:t>产品名称</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>SKU</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>面霜</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>A-1</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:document>';
  assert.deepEqual(docxTablesFromXml(xml), [[['产品名称', 'SKU'], ['面霜', 'A-1']]]);
});

test('DOCX 图片作为未归属图片返回，不静默绑定产品', async () => {
  const xml = '<w:document><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>产品名称</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>SKU</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>面霜</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>A-1</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
  const file = new File([storedZip({ 'word/document.xml': xml, 'word/media/image1.png': new Uint8Array([137, 80, 78, 71]) })], 'products.docx');
  const result = await parseProductDocument(file);
  assert.equal(result.products[0]?.name, '面霜');
  assert.equal(result.products[0]?.imageUrl, undefined);
  assert.equal(result.unassignedImages[0]?.name, 'image1.png');
  assert.ok(result.unassignedImages[0]?.file instanceof File);
  assert.equal(result.unassignedImages[0]?.file.type, 'image/png');
  result.unassignedImages.forEach(image => URL.revokeObjectURL(image.url));
});
