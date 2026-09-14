import * as XLSX from 'xlsx';

/**
 * Product imports run in the browser, but the files are still untrusted input.
 * Keep these limits deliberately below Excel's technical maximum so a malformed
 * workbook cannot monopolize a tab with ZIP expansion or enormous sparse ranges.
 */
export const PRODUCT_IMPORT_LIMITS = Object.freeze({
  maxFileBytes: 10 * 1024 * 1024,
  maxArchiveEntries: 2_048,
  maxArchiveUncompressedBytes: 64 * 1024 * 1024,
  maxArchiveEntryBytes: 32 * 1024 * 1024,
  maxSheets: 20,
  maxRowsPerSheet: 20_000,
  maxColumnsPerSheet: 256,
  maxCellsPerSheet: 750_000,
  maxCellsPerWorkbook: 1_000_000,
  maxMergedCellsPerWorkbook: 50_000,
  maxCellTextLength: 32_767,
  maxTextCharactersPerWorkbook: 8 * 1024 * 1024,
});

type SupportedProductFileType = 'csv' | 'xls' | 'xlsx';

const WORKBOOK_READ_OPTIONS: XLSX.ParsingOptions = {
  cellDates: false,
  cellFormula: false,
  cellHTML: false,
  cellNF: false,
  cellStyles: false,
  sheetRows: PRODUCT_IMPORT_LIMITS.maxRowsPerSheet + 1,
  bookDeps: false,
  bookFiles: false,
  bookVBA: false,
  WTF: false,
};

const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const OLE_COMPOUND_FILE_HEADER = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;

function importError(message: string): Error {
  return new Error(`产品文件解析失败：${message}`);
}

function productFileType(fileName: string): SupportedProductFileType {
  const match = /\.([^.]+)$/.exec(fileName.trim().toLowerCase());
  const extension = match?.[1];
  if (extension === 'csv' || extension === 'xls' || extension === 'xlsx') return extension;
  throw importError('仅支持 .csv、.xls 和 .xlsx 文件');
}

function startsWithBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function assertFileEnvelope(file: File): SupportedProductFileType {
  const type = productFileType(file.name);
  if (!Number.isFinite(file.size) || file.size <= 0) throw importError('文件为空');
  if (file.size > PRODUCT_IMPORT_LIMITS.maxFileBytes) {
    throw importError(`文件不能超过 ${PRODUCT_IMPORT_LIMITS.maxFileBytes / 1024 / 1024} MB`);
  }
  return type;
}

function findZipEndOfCentralDirectory(bytes: Uint8Array, view: DataView): number {
  // EOCD is at least 22 bytes and its comment is limited to 65,535 bytes by ZIP32.
  const earliest = Math.max(0, bytes.byteLength - 22 - 0xffff);
  for (let offset = bytes.byteLength - 22; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) !== ZIP_END_OF_CENTRAL_DIRECTORY) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === bytes.byteLength) return offset;
  }
  throw importError('Excel 压缩包目录损坏');
}

function assertSafeXlsxArchive(bytes: Uint8Array): void {
  if (bytes.byteLength < 22 || !startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    throw importError('.xlsx 扩展名与文件内容不匹配');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findZipEndOfCentralDirectory(bytes, view);
  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const directoryDisk = view.getUint16(eocdOffset + 6, true);
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const directorySize = view.getUint32(eocdOffset + 12, true);
  const directoryOffset = view.getUint32(eocdOffset + 16, true);

  if (diskNumber !== 0 || directoryDisk !== 0 || entriesOnDisk !== entryCount) {
    throw importError('不支持分卷 Excel 压缩包');
  }
  if (entryCount === 0 || entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw importError('Excel 压缩包为空或使用了不支持的 ZIP64 结构');
  }
  if (entryCount > PRODUCT_IMPORT_LIMITS.maxArchiveEntries) {
    throw importError(`Excel 压缩包文件项不能超过 ${PRODUCT_IMPORT_LIMITS.maxArchiveEntries} 个`);
  }
  if (directoryOffset + directorySize > eocdOffset) throw importError('Excel 压缩包目录越界');

  let cursor = directoryOffset;
  let totalUncompressedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > eocdOffset || view.getUint32(cursor, true) !== ZIP_CENTRAL_DIRECTORY_HEADER) {
      throw importError('Excel 压缩包目录项损坏');
    }
    const flags = view.getUint16(cursor + 8, true);
    const compressedBytes = view.getUint32(cursor + 20, true);
    const uncompressedBytes = view.getUint32(cursor + 24, true);
    const fileNameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const nextCursor = cursor + 46 + fileNameLength + extraLength + commentLength;

    if ((flags & 0x0001) !== 0) throw importError('不支持加密的 Excel 压缩包');
    if (compressedBytes === 0xffffffff || uncompressedBytes === 0xffffffff) {
      throw importError('不支持 ZIP64 Excel 压缩包');
    }
    if (nextCursor > eocdOffset || nextCursor > directoryOffset + directorySize) {
      throw importError('Excel 压缩包目录项越界');
    }
    if (uncompressedBytes > PRODUCT_IMPORT_LIMITS.maxArchiveEntryBytes) {
      throw importError(`Excel 压缩包单项展开后不能超过 ${PRODUCT_IMPORT_LIMITS.maxArchiveEntryBytes / 1024 / 1024} MB`);
    }
    totalUncompressedBytes += uncompressedBytes;
    if (totalUncompressedBytes > PRODUCT_IMPORT_LIMITS.maxArchiveUncompressedBytes) {
      throw importError(`Excel 压缩包展开后不能超过 ${PRODUCT_IMPORT_LIMITS.maxArchiveUncompressedBytes / 1024 / 1024} MB`);
    }
    cursor = nextCursor;
  }
  if (cursor !== directoryOffset + directorySize) throw importError('Excel 压缩包目录长度不一致');
}

function assertSafeXlsEnvelope(bytes: Uint8Array): void {
  if (!startsWithBytes(bytes, OLE_COMPOUND_FILE_HEADER)) {
    throw importError('.xls 扩展名与文件内容不匹配，仅支持标准 Excel 97-2003 工作簿');
  }
}

function assertSafeCsvEnvelope(bytes: Uint8Array): void {
  // The importer intentionally supports UTF-8 and GB18030 text, not binary or
  // UTF-16 payloads disguised as CSV. This prevents parser format sniffing.
  if (bytes.includes(0)) throw importError('CSV 必须是 UTF-8 或 GB18030 文本');
}

function decodeCsv(bytes: Uint8Array): string {
  let decoded = new TextDecoder('utf-8').decode(bytes);
  const utf8Damage = (decoded.match(/�/g) || []).length + (decoded.match(/[ÃÂ]/g) || []).length;
  if (utf8Damage >= 2) {
    try { decoded = new TextDecoder('gb18030', { fatal: true }).decode(bytes); } catch { /* keep UTF-8 result */ }
  }
  return decoded;
}

function assertCsvQuoteStructure(value: string): void {
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '"') continue;
    if (quoted && value[index + 1] === '"') {
      index += 1;
      continue;
    }
    quoted = !quoted;
  }
  if (quoted) throw importError('CSV 文件存在未闭合的引号');
}

function rangeDimensions(sheet: XLSX.WorkSheet): { rows: number; columns: number; cells: number } {
  const reference = String(sheet['!fullref'] || sheet['!ref'] || '').trim();
  if (!reference) return { rows: 0, columns: 0, cells: 0 };
  if (reference.length > 64 || !/^\$?[A-Z]{1,3}\$?\d{1,7}(?::\$?[A-Z]{1,3}\$?\d{1,7})?$/i.test(reference)) {
    throw importError('工作表范围格式无效');
  }
  let range: XLSX.Range;
  try {
    range = XLSX.utils.decode_range(reference);
  } catch {
    throw importError('工作表范围格式无效');
  }
  const rows = range.e.r - range.s.r + 1;
  const columns = range.e.c - range.s.c + 1;
  if (rows <= 0 || columns <= 0 || !Number.isSafeInteger(rows * columns)) {
    throw importError('工作表范围无效');
  }
  if (range.s.r < 0 || range.e.r >= PRODUCT_IMPORT_LIMITS.maxRowsPerSheet) {
    throw importError(`工作表有效范围不能超过 ${PRODUCT_IMPORT_LIMITS.maxRowsPerSheet} 行`);
  }
  if (range.s.c < 0 || range.e.c >= PRODUCT_IMPORT_LIMITS.maxColumnsPerSheet) {
    throw importError(`工作表有效范围不能超过 ${PRODUCT_IMPORT_LIMITS.maxColumnsPerSheet} 列`);
  }
  return { rows, columns, cells: rows * columns };
}

function assertWorkbookLimits(workbook: XLSX.WorkBook): void {
  if (workbook.SheetNames.length > PRODUCT_IMPORT_LIMITS.maxSheets) {
    throw importError(`工作表不能超过 ${PRODUCT_IMPORT_LIMITS.maxSheets} 个`);
  }

  let workbookCells = 0;
  let mergedCells = 0;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) throw importError(`工作表“${name}”缺少数据`);
    const dimensions = rangeDimensions(sheet);
    if (dimensions.cells > PRODUCT_IMPORT_LIMITS.maxCellsPerSheet) {
      throw importError(`工作表“${name}”单元格范围不能超过 ${PRODUCT_IMPORT_LIMITS.maxCellsPerSheet} 个`);
    }
    workbookCells += dimensions.cells;
    if (workbookCells > PRODUCT_IMPORT_LIMITS.maxCellsPerWorkbook) {
      throw importError(`工作簿单元格范围不能超过 ${PRODUCT_IMPORT_LIMITS.maxCellsPerWorkbook} 个`);
    }

    for (const merge of sheet['!merges'] ?? []) {
      const rows = merge.e.r - merge.s.r + 1;
      const columns = merge.e.c - merge.s.c + 1;
      const area = rows * columns;
      if (rows <= 0 || columns <= 0 || merge.s.r < 0 || merge.s.c < 0
        || merge.e.r >= PRODUCT_IMPORT_LIMITS.maxRowsPerSheet
        || merge.e.c >= PRODUCT_IMPORT_LIMITS.maxColumnsPerSheet
        || !Number.isSafeInteger(area)) {
        throw importError(`工作表“${name}”包含无效合并区域`);
      }
      mergedCells += area;
      if (mergedCells > PRODUCT_IMPORT_LIMITS.maxMergedCellsPerWorkbook) {
        throw importError(`工作簿合并单元格展开后不能超过 ${PRODUCT_IMPORT_LIMITS.maxMergedCellsPerWorkbook} 个`);
      }
    }
  }
}

export function assertRowsAndTrackText(
  rows: unknown[][],
  sheetName: string,
  currentTextCharacters: number,
): number {
  if (rows.length > PRODUCT_IMPORT_LIMITS.maxRowsPerSheet) {
    throw importError(`工作表“${sheetName}”不能超过 ${PRODUCT_IMPORT_LIMITS.maxRowsPerSheet} 行`);
  }
  let textCharacters = currentTextCharacters;
  for (const row of rows) {
    if (row.length > PRODUCT_IMPORT_LIMITS.maxColumnsPerSheet) {
      throw importError(`工作表“${sheetName}”不能超过 ${PRODUCT_IMPORT_LIMITS.maxColumnsPerSheet} 列`);
    }
    for (const value of row) {
      if (value == null) continue;
      const length = String(value).length;
      if (length > PRODUCT_IMPORT_LIMITS.maxCellTextLength) {
        throw importError(`工作表“${sheetName}”存在超过 ${PRODUCT_IMPORT_LIMITS.maxCellTextLength} 字符的单元格`);
      }
      textCharacters += length;
      if (textCharacters > PRODUCT_IMPORT_LIMITS.maxTextCharactersPerWorkbook) {
        throw importError(`工作簿文本总量不能超过 ${PRODUCT_IMPORT_LIMITS.maxTextCharactersPerWorkbook} 字符`);
      }
    }
  }
  return textCharacters;
}

export async function readSafeProductWorkbook(file: File): Promise<XLSX.WorkBook> {
  const fileType = assertFileEnvelope(file);
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength === 0) throw importError('文件为空');
  if (buffer.byteLength > PRODUCT_IMPORT_LIMITS.maxFileBytes) {
    throw importError(`文件不能超过 ${PRODUCT_IMPORT_LIMITS.maxFileBytes / 1024 / 1024} MB`);
  }
  const bytes = new Uint8Array(buffer);
  let workbook: XLSX.WorkBook;
  if (fileType === 'csv') {
    assertSafeCsvEnvelope(bytes);
    const decoded = decodeCsv(bytes);
    assertCsvQuoteStructure(decoded);
    workbook = XLSX.read(decoded, { ...WORKBOOK_READ_OPTIONS, type: 'string' });
  } else {
    if (fileType === 'xlsx') assertSafeXlsxArchive(bytes);
    else assertSafeXlsEnvelope(bytes);
    workbook = XLSX.read(buffer, { ...WORKBOOK_READ_OPTIONS, type: 'array' });
  }
  assertWorkbookLimits(workbook);
  return workbook;
}
