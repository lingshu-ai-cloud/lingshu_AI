import { uploadProductEvidence } from '../../lib/enterpriseProductAssetUpload';
import type { EnterpriseOnboardingEvidenceRef } from '../../../shared/contracts/enterpriseOnboarding';
import { parseProductDocument, productsFromLabeledText, type DocumentProductDraft } from '../../lib/productDocumentImport';
import { readProductDiscoveryFile } from '../../lib/productDiscoveryFile';
import { heuristicProductMapping, mapRowToProduct, parseWorkbook, prepareSheet } from '../../lib/productImport';

export type OnboardingProduct = Record<string, unknown>;

export function onboardingProductName(product: OnboardingProduct): string {
  return String(product.name || product.title || product.productName || '').trim();
}

export function mergeOnboardingProducts(existingProducts: OnboardingProduct[], importedProducts: OnboardingProduct[]): OnboardingProduct[] {
  const next = [...existingProducts];
  for (const product of importedProducts) {
    const sku = String(product.sku || '').trim();
    const name = onboardingProductName(product);
    const existingIndex = next.findIndex(item => sku ? String(item.sku || '').trim() === sku : onboardingProductName(item) === name);
    if (existingIndex >= 0) {
      const existing = next[existingIndex];
      next[existingIndex] = { ...existing, ...product, id: String(existing.id || existing.productId || product.id) };
    } else next.push(product);
  }
  return next;
}

export interface OnboardingProductImportResult {
  products: OnboardingProduct[];
  importedCount: number;
  assignedImageCount: number;
  unassignedImageCount: number;
  sourceLabel: string;
  sourceEvidence: EnterpriseOnboardingEvidenceRef;
}

export async function importOnboardingProducts(file: File, existingProducts: OnboardingProduct[],
  uploadEvidence = uploadProductEvidence): Promise<OnboardingProductImportResult> {
  if (!/\.(xlsx?|csv|pdf|docx|txt)$/i.test(file.name)) throw new Error('请选择 Excel、CSV、PDF、Word 或 TXT 文件');
  if (file.size > 50 * 1024 * 1024) throw new Error('文件不能超过 50MB，请压缩或拆分后重试');
  const temporaryUrls: string[] = [];
  try {
    let importedProducts: DocumentProductDraft[];
    let unassignedImages: Array<{ name: string; url: string; file: File }> = [];
    let assignedImages: Array<{ productIndex: number; name: string; url: string; file: File }> = [];
    let sourceLabel = '表格字段识别';
    if (/\.(pdf|docx)$/i.test(file.name)) {
      const documentResult = await parseProductDocument(file);
      importedProducts = documentResult.products;
      sourceLabel = documentResult.sourceLabel;
      unassignedImages = documentResult.unassignedImages;
      assignedImages = documentResult.assignedImages;
      temporaryUrls.push(...unassignedImages.map(image => image.url), ...assignedImages.map(image => image.url));
    } else if (/\.txt$/i.test(file.name)) {
      importedProducts = productsFromLabeledText(await readProductDiscoveryFile(file));
      sourceLabel = 'TXT 字段识别';
    } else {
      const sheets = await parseWorkbook(file);
      const selectedSheet = sheets.slice().sort((a, b) => b.rowCount - a.rowCount)[0];
      if (!selectedSheet) throw new Error('文件中没有可读取的表格');
      const prepared = prepareSheet(selectedSheet);
      const mapping = heuristicProductMapping(prepared.headers);
      importedProducts = prepared.dataRows.map(row => mapRowToProduct(row, mapping));
    }
    const decoded = importedProducts
      .filter(item => item.name || item.sku)
      .map((item, index) => ({
        id: `import-${Date.now()}-${index}`,
        ...item,
        name: item.name || item.sku || `导入产品 ${index + 1}`,
        priceRange: item.retailPrice || item.tagPrice || '',
        images: item.imageUrl ? [{ name: item.imageUrl.split('/').pop() || '产品图片', type: 'image/url', size: 0, updatedAt: new Date().toISOString(), url: item.imageUrl }] : [],
        videos: [], documents: [], source: 'product_file_import',
      }));
    if (!decoded.length) throw new Error('未识别到有效产品，请确认表格包含“产品名称”或“SKU/货号”列');
    const sourceAsset = await uploadEvidence(file);
    if (!sourceAsset.url || !sourceAsset.sha256) throw new Error('原始产品资料上传后缺少可核验回执');
    for (const image of assignedImages) {
      const product = decoded[image.productIndex];
      if (!product) continue;
      const asset = await uploadEvidence(image.file);
      if (!asset.url) throw new Error('PDF 产品图片上传后缺少可用地址');
      product.images.push({ ...asset, url: asset.url });
      if (!product.imageUrl) product.imageUrl = asset.url;
    }
    // No product identity means there is nowhere durable to bind these bytes.
    // Do not upload orphan evidence or claim that it survived the import.
    return {
      products: mergeOnboardingProducts(existingProducts, decoded),
      importedCount: decoded.length,
      assignedImageCount: assignedImages.length,
      unassignedImageCount: unassignedImages.length,
      sourceLabel,
      sourceEvidence: {
        id: `onboarding-source:${sourceAsset.sha256}`,
        kind: 'source_document', name: sourceAsset.name, mimeType: sourceAsset.type,
        size: sourceAsset.size, sha256: sourceAsset.sha256, url: sourceAsset.url,
        capturedAt: sourceAsset.updatedAt, status: 'uploaded',
      },
    };
  } finally {
    temporaryUrls.forEach(url => URL.revokeObjectURL(url));
  }
}
