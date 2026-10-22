import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./EnterprisePage.tsx', import.meta.url), 'utf8');
const parserSource = readFileSync(new URL('../lib/productDocumentImport.ts', import.meta.url), 'utf8');
const assetUploadSource = readFileSync(new URL('../lib/enterpriseProductAssetUpload.ts', import.meta.url), 'utf8');
const confirmationSource = readFileSync(new URL('./enterprise/enterpriseProductImportConfirmation.ts', import.meta.url), 'utf8');

test('文档未归属图片在确认导入时持久化且失败可见', () => {
  assert.match(source, /confirmEnterpriseProductImportAssets\(/);
  assert.match(confirmationSource, /ports\.upload\(image\.file\)/);
  assert.match(confirmationSource, /图片上传失败，产品尚未导入/);
  assert.match(source, /持久化到“企业上传素材”/);
  assert.match(source, /productImportConfirming/);
});

test('产品导入入口支持 PDF 与 DOCX', () => {
  assert.match(source, /accept="\.xlsx,\.xls,\.csv,\.pdf,\.docx"/);
  assert.doesNotMatch(source, /Word 和 PDF 产品资料尚不支持/);
});

test('PDF 含图页面会渲染为可上传 File', () => {
  assert.match(parserSource, /async function renderPdfVisualPages\(/);
  assert.match(parserSource, /getOperatorList\(\)/);
  assert.match(parserSource, /paintImageXObject/);
  assert.match(parserSource, /new File\(\[blob\], name/);
  assert.match(parserSource, /PDF 文本与嵌入图片提取/);
  assert.match(parserSource, /extractPdfProductImages\(/, '产品图应取自 PDF 图片对象，而非整页 OCR 预览');
});

test('产品外链主图必须转存为租户资产后才能导入', () => {
  assert.match(assetUploadSource, /enterprise\/assets\/import-url/);
  assert.match(source, /importUrl: importProductEvidenceUrl/);
  assert.match(confirmationSource, /ports\.importUrl\(transfer\.originalUrl/);
  assert.match(confirmationSource, /product\.imageUrl = asset\.url/);
  assert.match(confirmationSource, /产品外链图片转存失败，产品尚未导入/);
  assert.match(source, /待转存/);
});
