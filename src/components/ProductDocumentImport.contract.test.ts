import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./EnterprisePage.tsx', import.meta.url), 'utf8');
const parserSource = readFileSync(new URL('../lib/productDocumentImport.ts', import.meta.url), 'utf8');

test('文档未归属图片在确认导入时持久化且失败可见', () => {
  assert.match(source, /uploadProductEvidence\(image\.file\)/);
  assert.match(source, /图片上传失败，产品尚未导入/);
  assert.match(source, /持久化到“企业上传素材”/);
  assert.match(source, /productImportConfirming/);
});

test('产品导入入口支持 PDF 与 DOCX', () => {
  assert.match(source, /accept="\.xlsx,\.xls,\.csv,\.pdf,\.docx"/);
  assert.doesNotMatch(source, /Word 和 PDF 产品资料尚不支持/);
});

test('PDF 含图页面会渲染为可上传 File', () => {
  assert.match(parserSource, /getOperatorList\(\)/);
  assert.match(parserSource, /paintImageXObject/);
  assert.match(parserSource, /new File\(\[blob\], name/);
  assert.match(parserSource, /PDF 文本与含图页面提取/);
});

test('产品外链主图必须转存为租户资产后才能导入', () => {
  assert.match(source, /enterprise\/assets\/import-url/);
  assert.match(source, /importProductEvidenceUrl\(transfer\.originalUrl/);
  assert.match(source, /product\.imageUrl = asset\.url/);
  assert.match(source, /产品外链图片转存失败，产品尚未导入/);
  assert.match(source, /待转存/);
});
