import { heuristicProductMapping, mapRowToProduct, parseWorkbook, prepareSheet } from '../../lib/productImport';
import { parseProductDocument } from '../../lib/productDocumentImport';
import type { ProductItem } from './enterpriseProfileTypes';

export interface PendingProductImport {
  fileName: string;
  sheetName: string;
  products: ProductItem[];
  totalRows: number;
  skippedRows: number;
  sourceLabel: string;
  unassignedImages: Array<{ name: string; url: string; file: File; status?: 'pending' | 'uploading' | 'uploaded' | 'failed'; error?: string }>;
  assignedImages: Array<{ productIndex: number; name: string; url: string; file: File; uploadedUrl?: string }>;
  remoteImageTransfers: Record<number, { status: 'pending' | 'uploading' | 'uploaded' | 'failed'; error?: string; originalUrl: string }>;
}

export function remoteProductImageTransfers(products: ProductItem[]): PendingProductImport['remoteImageTransfers'] {
  return Object.fromEntries(products.flatMap((item, index) => item.imageUrl && !item.imageUrl.startsWith('/api/overseas/enterprise/assets/')
    ? [[index, { status: 'pending' as const, originalUrl: item.imageUrl }]] : []));
}

export async function prepareEnterpriseProductImport(file: File, category: string): Promise<{ pending: PendingProductImport; message: string }> {
  if (/\.(pdf|docx)$/i.test(file.name)) {
    const parsed = await parseProductDocument(file);
    const incoming = parsed.products.map((item, index): ProductItem => ({
      ...item,
      name: item.name || item.sku || `导入产品${index + 1}`,
      priceRange: item.retailPrice || item.tagPrice,
      category,
      images: item.imageUrl ? [{ name: item.imageUrl.split('/').pop() || '商品主图', type: 'image/url', size: 0, updatedAt: new Date().toISOString(), url: item.imageUrl }] : [],
      videos: [],
      documents: [],
    }));
    return {
      pending: { fileName: file.name, sheetName: '文档正文', products: incoming, totalRows: incoming.length, skippedRows: 0, sourceLabel: parsed.sourceLabel, unassignedImages: parsed.unassignedImages, assignedImages: parsed.assignedImages, remoteImageTransfers: remoteProductImageTransfers(incoming) },
      message: `已从文档识别 ${incoming.length} 个产品，请确认字段与图片归属后导入`,
    };
  }

  const sheets = await parseWorkbook(file);
  const selected = sheets.slice().sort((a, b) => b.rowCount - a.rowCount)[0];
  if (!selected) throw new Error('没有读取到可导入的表格');
  const prepared = prepareSheet(selected);
  const mapping = heuristicProductMapping(prepared.headers);
  const incoming = prepared.dataRows
    .map(row => mapRowToProduct(row, mapping) as Partial<ProductItem>)
    .filter(item => item.name || item.sku)
    .map((item, index): ProductItem => ({
      name: item.name || item.sku || `导入产品${index + 1}`,
      sku: item.sku,
      color: item.color,
      size: item.size,
      tagPrice: item.tagPrice,
      retailPrice: item.retailPrice,
      moq: item.moq,
      brand: item.brand,
      material: item.material,
      imageUrl: item.imageUrl,
      priceRange: item.retailPrice || item.tagPrice,
      category,
      highlights: item.highlights,
      images: item.imageUrl ? [{ name: item.imageUrl.split('/').pop() || '商品主图', type: 'image/url', size: 0, updatedAt: new Date().toISOString(), url: item.imageUrl }] : [],
      videos: [],
      documents: [],
    }));
  if (!incoming.length) throw new Error('没有识别到有效产品行，请检查表头是否包含商品名称或 SKU');
  const skipped = prepared.dataRows.length - incoming.length;
  return {
    pending: { fileName: file.name, sheetName: prepared.sheetName, products: incoming, totalRows: prepared.dataRows.length, skippedRows: skipped, sourceLabel: '表格字段映射', unassignedImages: [], assignedImages: [], remoteImageTransfers: remoteProductImageTransfers(incoming) },
    message: `已解析 ${incoming.length} 个产品，请确认产品与图片对应关系后导入`,
  };
}
