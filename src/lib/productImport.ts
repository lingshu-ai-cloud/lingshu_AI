import readXlsxFile from 'read-excel-file/browser';

export const PRODUCT_SCHEMA_FIELDS = [
  'sku',
  'name',
  'color',
  'size',
  'tagPrice',
  'retailPrice',
  'moq',
  'brand',
  'material',
  'imageUrl',
  'highlights',
] as const;

export type ProductSchemaField = (typeof PRODUCT_SCHEMA_FIELDS)[number];
export type ProductMapping = Record<string, ProductSchemaField | ''>;

export const PRODUCT_FIELD_LABELS: Record<ProductSchemaField, string> = {
  sku: '货号',
  name: '商品名称',
  color: '颜色',
  size: '尺码',
  tagPrice: '吊牌价',
  retailPrice: '零售价',
  moq: '起订量',
  brand: '品牌',
  material: '面料/材质',
  imageUrl: '图片URL',
  highlights: '一句话卖点',
};

export interface ParsedSheet {
  name: string;
  rows: unknown[][];
  rowCount: number;
}

export interface PreparedSheet {
  sheetName: string;
  headerRowIndex: number;
  headers: string[];
  sampleRows: Record<string, string>[];
  dataRows: Record<string, string>[];
}

const MAX_WORKBOOK_BYTES = 10 * 1024 * 1024;
const MAX_WORKBOOK_SHEETS = 20;
const MAX_WORKBOOK_ROWS = 20_000;
const MAX_WORKBOOK_COLUMNS = 200;

const text = (v: unknown) => (v == null ? '' : String(v).trim());

function normalizeRows(rows: unknown[][]): string[][] {
  return rows.map(row => row.map(text));
}

function textRatio(row: string[]) {
  const cells = row.filter(Boolean);
  if (!cells.length) return 0;
  return cells.filter(cell => /[\u4e00-\u9fa5a-zA-Z]/.test(cell) && !/^\d+(\.\d+)?$/.test(cell)).length / cells.length;
}

const HEADER_HINT = /货号|款号|编码|sku|spu|品名|名称|商品|产品|标题|颜色|色号|尺码|规格|尺寸|吊牌|零售|价格|售价|金额|起订|最小订单|moq|品牌|brand|面料|材质|成分|图片|主图|照片|链接|卖点|亮点|描述|category|product|name|color|size|price|material|fabric|image|photo|url|description/i;

function headerHintCount(row: string[]) {
  return row.filter(cell => HEADER_HINT.test(cell)).length;
}

function numberRatio(row: string[]) {
  const cells = row.filter(Boolean);
  if (!cells.length) return 0;
  return cells.filter(cell => /^[-+]?\d+(?:[.,]\d+)?(?:%|元|美元|usd)?$/i.test(cell)).length / cells.length;
}

function averageCellLength(row: string[]) {
  const cells = row.filter(Boolean);
  return cells.length ? cells.reduce((sum, cell) => sum + cell.length, 0) / cells.length : 0;
}

function regularity(rows: string[][], start: number) {
  const sample = rows.slice(start, start + 5).filter(row => row.some(Boolean));
  if (sample.length < 2) return 0;
  const widths = sample.map(row => row.filter(Boolean).length);
  const avg = widths.reduce((sum, width) => sum + width, 0) / widths.length;
  const dev = widths.reduce((sum, width) => sum + Math.abs(width - avg), 0) / widths.length;
  return Math.max(0, avg - dev);
}

export function findLikelyHeaderRow(rows: string[][]) {
  let best = { index: 0, score: -1 };
  for (let i = 0; i < Math.min(rows.length, 30); i += 1) {
    const nonEmpty = rows[i]?.filter(Boolean).length ?? 0;
    if (nonEmpty < 2) continue;
    const row = rows[i]!;
    const hints = headerHintCount(row);
    const nextRegularity = regularity(rows, i + 1);
    const previousRowsSparse = rows.slice(Math.max(0, i - 3), i).every(item => item.filter(Boolean).length <= Math.max(2, nonEmpty / 2));
    const score = hints * 9
      + nonEmpty * 0.45
      + textRatio(row) * 3
      + nextRegularity * 1.2
      + (previousRowsSparse ? 1.5 : 0)
      - numberRatio(row) * 5
      - Math.max(0, averageCellLength(row) - 18) * 0.15;
    if (score > best.score) best = { index: i, score };
  }
  return best.index;
}

function uniqueHeaders(headers: string[]) {
  const used = new Map<string, number>();
  return headers.map((header, index) => {
    const base = header || `未命名列${index + 1}`;
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return count ? `${base}-${count + 1}` : base;
  });
}

function headersFrom(rows: string[][], headerRowIndex: number) {
  const top = rows[headerRowIndex] ?? [];
  const next = rows[headerRowIndex + 1] ?? [];
  const doubleHeader = textRatio(next) > 0.72 && regularity(rows, headerRowIndex + 2) >= regularity(rows, headerRowIndex + 1);
  const width = Math.max(top.length, doubleHeader ? next.length : 0);
  return uniqueHeaders(Array.from({ length: width }, (_, index) => {
    const a = top[index] || '';
    const b = doubleHeader ? next[index] || '' : '';
    return a && b && a !== b ? `${a}-${b}` : a || b || `未命名列${index + 1}`;
  }));
}

function rowsToObjects(rows: string[][], headers: string[], start: number) {
  return rows
    .slice(start)
    .filter(row => row.some(Boolean))
    .map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

function parseCsv(textValue: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < textValue.length; index += 1) {
    const char = textValue[index]!;
    if (quoted) {
      if (char === '"' && textValue[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"' && field.length === 0) { quoted = true; continue; }
    if (char === ',') { row.push(field); field = ''; continue; }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && textValue[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some(cell => cell !== '')) rows.push(row);
      if (rows.length > MAX_WORKBOOK_ROWS) throw new Error(`表格最多支持 ${MAX_WORKBOOK_ROWS} 行`);
      row = [];
      field = '';
      continue;
    }
    field += char;
  }
  if (quoted) throw new Error('CSV 文件存在未闭合的引号');
  row.push(field);
  if (row.some(cell => cell !== '')) rows.push(row);
  return rows;
}

function validateSheet(name: string, rows: unknown[][]): ParsedSheet {
  if (rows.length > MAX_WORKBOOK_ROWS) throw new Error(`工作表“${name}”超过 ${MAX_WORKBOOK_ROWS} 行`);
  if (rows.some(row => row.length > MAX_WORKBOOK_COLUMNS)) throw new Error(`工作表“${name}”超过 ${MAX_WORKBOOK_COLUMNS} 列`);
  return { name, rows, rowCount: rows.length };
}

export async function parseWorkbook(file: File): Promise<ParsedSheet[]> {
  if (!file || file.size <= 0) throw new Error('请选择非空的产品表格');
  if (file.size > MAX_WORKBOOK_BYTES) throw new Error('产品表格不能超过 10 MB');
  if (/\.xls$/i.test(file.name)) throw new Error('为保障导入安全，旧版 .xls 已停用，请另存为 .xlsx 或 .csv 后上传');
  const isCsv = /\.csv$/i.test(file.name);
  if (!isCsv && !/\.xlsx$/i.test(file.name)) throw new Error('仅支持 .xlsx 或 .csv 产品表格');
  if (isCsv) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let decoded = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
    const utf8Damage = (decoded.match(/�/g) || []).length + (decoded.match(/[ÃÂ]/g) || []).length;
    if (utf8Damage >= 2) {
      try { decoded = new TextDecoder('gb18030').decode(bytes); } catch { /* keep UTF-8 result */ }
    }
    const name = file.name.replace(/\.csv$/i, '') || 'CSV';
    return [validateSheet(name, parseCsv(decoded))];
  }
  const sheets = await readXlsxFile(file, { trim: true });
  if (sheets.length > MAX_WORKBOOK_SHEETS) throw new Error(`工作簿最多支持 ${MAX_WORKBOOK_SHEETS} 个工作表`);
  return sheets.map(sheet => validateSheet(sheet.sheet, sheet.data));
}

export function prepareSheet(sheet: ParsedSheet, forcedHeaderRowIndex?: number): PreparedSheet {
  const rows = normalizeRows(sheet.rows);
  const detectedHeaderRowIndex = findLikelyHeaderRow(rows);
  const headerRowIndex = Number.isInteger(forcedHeaderRowIndex)
    ? Math.max(0, Math.min(rows.length - 1, Number(forcedHeaderRowIndex)))
    : detectedHeaderRowIndex;
  const headers = headersFrom(rows, headerRowIndex);
  const dataStart = headerRowIndex + (headers.some(header => header.includes('-')) ? 2 : 1);
  const dataRows = rowsToObjects(rows, headers, dataStart);
  return {
    sheetName: sheet.name,
    headerRowIndex,
    headers,
    sampleRows: dataRows.slice(0, 5),
    dataRows,
  };
}

const RULES: Array<[ProductSchemaField, RegExp]> = [
  ['sku', /货号|款号|sku|spu|编码|商品编号/i],
  ['name', /品名|名称|商品|标题|product/i],
  ['color', /颜色|色号|color/i],
  ['size', /尺码|规格|尺寸|size|s\/m\/l/i],
  ['retailPrice', /零售价|零售价格|建议零售价|零售指导价|销售价|售价|价格|金额|retail\s*price|selling\s*price|price|rrp/i],
  ['tagPrice', /吊牌价|标签价|标价|tag\s*price/i],
  ['moq', /起订量|最小起订|最低起订|最小订单量|moq|minimum\s*order/i],
  ['brand', /品牌|牌子|brand/i],
  ['material', /面料|材质|成分|material|fabric/i],
  ['imageUrl', /图片|主图|image|photo|url|链接/i],
  ['highlights', /卖点|亮点|描述|description|brief/i],
];

export function heuristicProductMapping(headers: string[]): ProductMapping {
  const mapping: ProductMapping = {};
  const used = new Set<ProductSchemaField>();
  for (const header of headers) {
    const hit = RULES.find(([field, pattern]) => !used.has(field) && pattern.test(header));
    mapping[header] = hit?.[0] ?? '';
    if (hit?.[0]) used.add(hit[0]);
  }
  return mapping;
}

export function mapRowToProduct(row: Record<string, string>, mapping: ProductMapping) {
  const product: Record<string, string> = {};
  for (const [source, target] of Object.entries(mapping)) {
    if (!target) continue;
    const value = row[source]?.trim();
    if (value) product[target] = value;
  }
  if (!product.name && product.sku) product.name = product.sku;
  return product;
}
