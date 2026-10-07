import { heuristicProductMapping, mapRowToProduct } from './productImport';
import { readProductDiscoveryFile, validateProductDiscoveryFileSize } from './productDiscoveryFile';

export interface DocumentProductDraft {
  name?: string;
  sku?: string;
  color?: string;
  size?: string;
  tagPrice?: string;
  retailPrice?: string;
  moq?: string;
  brand?: string;
  material?: string;
  imageUrl?: string;
  highlights?: string;
}

export interface ProductDocumentParseResult {
  sourceLabel: string;
  products: DocumentProductDraft[];
  unassignedImages: Array<{ name: string; url: string; file: File }>;
  needsReview: true;
}

const MAX_DOCX_ENTRIES = 1024;
const MAX_DOCX_EXPANDED = 48 * 1024 * 1024;
const MAX_DOCX_ENTRY = 16 * 1024 * 1024;
const decoder = new TextDecoder('utf-8');

function decodeXml(value: string): string {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
}

function xmlText(value: string): string {
  return decodeXml(Array.from(value.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)).map(match => match[1]).join(' ')).replace(/\s+/g, ' ').trim();
}

export function docxTablesFromXml(xml: string): string[][][] {
  return Array.from(xml.matchAll(/<w:tbl(?:\s[^>]*)?>([\s\S]*?)<\/w:tbl>/g)).map(table =>
    Array.from(table[1].matchAll(/<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g)).map(row =>
      Array.from(row[1].matchAll(/<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g)).map(cell => xmlText(cell[1])),
    ).filter(row => row.some(Boolean)),
  ).filter(rows => rows.length > 1);
}

function productsFromRows(rows: string[][]): DocumentProductDraft[] {
  if (rows.length < 2) return [];
  const headers = rows[0].map((header, index) => header || `未命名列${index + 1}`);
  const mapping = heuristicProductMapping(headers);
  return rows.slice(1).map(row => mapRowToProduct(Object.fromEntries(headers.map((header, index) => [header, row[index] || ''])), mapping)).filter(item => item.name || item.sku);
}

export function productsFromLabeledText(text: string): DocumentProductDraft[] {
  const normalized = text.replace(/第\d+页/g, '\n').replace(/[；;]/g, '\n');
  const blocks = normalized.split(/(?=(?:产品|商品)?(?:名称|品名)\s*[:：])/i).map(item => item.trim()).filter(Boolean);
  const anyLabel = '产品名称|商品名称|品名|名称|SKU|货号|款号|商品编号|品牌|brand|颜色|color|规格|尺寸|尺码|size|零售价|售价|价格|price|起订量|MOQ|最小订单量|材质|面料|成分|material|图片URL|主图URL|图片链接|卖点|亮点|产品描述|描述';
  const field = (block: string, labels: string) => new RegExp(`(?:${labels})\\s*[:：]\\s*([^\\n|]{1,160}?)(?=\\s+(?:${anyLabel})\\s*[:：]|$)`, 'i').exec(block)?.[1]?.trim();
  return blocks.map(block => ({
    name: field(block, '产品名称|商品名称|品名|名称'),
    sku: field(block, 'SKU|货号|款号|商品编号'),
    brand: field(block, '品牌|brand'),
    color: field(block, '颜色|color'),
    size: field(block, '规格|尺寸|尺码|size'),
    retailPrice: field(block, '零售价|售价|价格|price'),
    moq: field(block, '起订量|MOQ|最小订单量'),
    material: field(block, '材质|面料|成分|material'),
    imageUrl: field(block, '图片URL|主图URL|图片链接'),
    highlights: field(block, '卖点|亮点|产品描述|描述'),
  })).filter(item => item.name || item.sku);
}

interface ZipEntry { name: string; method: number; compressedSize: number; uncompressedSize: number; localOffset: number }

function zipEntries(bytes: Uint8Array): ZipEntry[] {
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('DOCX 文件格式不正确');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 0xffff); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error('DOCX 压缩包目录损坏');
  const count = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (!count || count > MAX_DOCX_ENTRIES || directoryOffset + directorySize > eocd) throw new Error('DOCX 压缩包超出安全限制');
  const entries: ZipEntry[] = [];
  let cursor = directoryOffset;
  let expanded = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > eocd || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('DOCX 压缩包目录项损坏');
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const fileNameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    if (flags & 1 || ![0, 8].includes(method) || uncompressedSize > MAX_DOCX_ENTRY) throw new Error('DOCX 包含不支持或不安全的文件项');
    expanded += uncompressedSize;
    if (expanded > MAX_DOCX_EXPANDED) throw new Error('DOCX 展开后内容过大');
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + fileNameLength));
    if (name.includes('..') || name.startsWith('/')) throw new Error('DOCX 包含不安全的文件路径');
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

async function extractZipEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (entry.localOffset + 30 > bytes.length || view.getUint32(entry.localOffset, true) !== 0x04034b50) throw new Error('DOCX 文件项损坏');
  const nameLength = view.getUint16(entry.localOffset + 26, true);
  const extraLength = view.getUint16(entry.localOffset + 28, true);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const compressed = bytes.subarray(start, start + entry.compressedSize);
  if (start + entry.compressedSize > bytes.length) throw new Error('DOCX 文件项越界');
  if (entry.method === 0) return compressed.slice();
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw' as CompressionFormat));
  const result = new Uint8Array(await new Response(stream).arrayBuffer());
  if (result.length !== entry.uncompressedSize) throw new Error('DOCX 文件项解压长度异常');
  return result;
}

function mimeForImage(name: string): string | null {
  const extension = name.split('.').pop()?.toLowerCase();
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' } as Record<string, string>)[extension || ''] || null;
}

async function renderPdfVisualPages(file: File): Promise<Array<{ name: string; url: string; file: File }>> {
  if (typeof document === 'undefined') return [];
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
  const results: Array<{ name: string; url: string; file: File }> = [];
  try {
    const pdf = await task.promise;
    const imageOps = new Set([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject]);
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const operators = await page.getOperatorList();
      if (!operators.fnArray.some(operator => imageOps.has(operator))) continue;
      const viewport = page.getViewport({ scale: 1 });
      const maxWidth = 1200;
      const scale = Math.min(1, maxWidth / Math.max(1, viewport.width));
      const renderViewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(renderViewport.width));
      canvas.height = Math.max(1, Math.ceil(renderViewport.height));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('浏览器无法创建 PDF 页面预览');
      await page.render({ canvas, canvasContext: context, viewport: renderViewport }).promise;
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PDF 页面图片生成失败')), 'image/jpeg', 0.86));
      const name = `${file.name.replace(/\.pdf$/i, '')}-第${pageNumber}页.jpg`;
      const imageFile = new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified });
      results.push({ name, file: imageFile, url: URL.createObjectURL(imageFile) });
    }
  } finally {
    await task.destroy();
  }
  return results;
}

export async function parseProductDocument(file: File): Promise<ProductDocumentParseResult> {
  validateProductDiscoveryFileSize(file.name, file.size);
  if (/\.pdf$/i.test(file.name)) {
    const text = await readProductDiscoveryFile(file);
    const products = productsFromLabeledText(text);
    if (!products.length) throw new Error('PDF 中未识别到带名称或 SKU 的产品，请确认文档使用“产品名称：…”等清晰字段');
    const unassignedImages = await renderPdfVisualPages(file);
    return { sourceLabel: 'PDF 文本与含图页面提取', products, unassignedImages, needsReview: true };
  }
  if (!/\.docx$/i.test(file.name)) throw new Error('文档导入仅支持 PDF 和 DOCX');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = zipEntries(bytes);
  const documentEntry = entries.find(entry => entry.name === 'word/document.xml');
  if (!documentEntry) throw new Error('DOCX 缺少正文内容');
  const xml = decoder.decode(await extractZipEntry(bytes, documentEntry));
  const tableProducts = docxTablesFromXml(xml).flatMap(rows => productsFromRows(rows));
  const products = tableProducts.length ? tableProducts : productsFromLabeledText(xmlText(xml).replace(/\s+(?=(?:产品|商品)?(?:名称|品名)\s*[:：])/g, '\n'));
  if (!products.length) throw new Error('DOCX 中未识别到带名称或 SKU 的产品，请检查表头或字段标签');
  const unassignedImages: Array<{ name: string; url: string; file: File }> = [];
  for (const entry of entries.filter(item => item.name.startsWith('word/media/'))) {
    const mime = mimeForImage(entry.name);
    if (!mime) continue;
    const image = await extractZipEntry(bytes, entry);
    const name = entry.name.split('/').pop() || '文档图片';
    const imageFile = new File([image], name, { type: mime, lastModified: file.lastModified });
    unassignedImages.push({ name, file: imageFile, url: URL.createObjectURL(imageFile) });
  }
  return { sourceLabel: tableProducts.length ? 'DOCX 表格提取' : 'DOCX 文本提取', products, unassignedImages, needsReview: true };
}
