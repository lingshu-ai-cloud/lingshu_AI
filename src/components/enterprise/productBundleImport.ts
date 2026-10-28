import type { ProductItem } from './enterpriseProfileTypes';
import type { PendingProductImport } from './enterpriseProductImportPreparation';

const MAX_BUNDLE_BYTES = 60 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_FIELDS = new Set(['imageUrl', 'images', 'packagingImages', 'factoryImages', 'certificateImages', 'sceneImages', 'brandAssets']);
const PRODUCT_FIELDS = ['id', 'productId', 'sku', 'name', 'category', 'color', 'size', 'tagPrice', 'retailPrice',
  'brand', 'material', 'priceRange', 'moq', 'samplePolicy', 'paymentTerms', 'leadTime', 'customization',
  'certifications', 'highlights'] as const;

function decodeBase64(value: string): Uint8Array {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

export async function prepareProductBundleImport(file: File): Promise<PendingProductImport> {
  if (file.size > MAX_BUNDLE_BYTES) throw new Error('产品迁移文件超过 60 MB 上限');
  const raw = JSON.parse(await file.text()) as Record<string, unknown>;
  if (raw.schemaVersion !== 'lingshu-product-bundle.v1' || !Array.isArray(raw.products) || !Array.isArray(raw.assets))
    throw new Error('不是受支持的灵枢产品迁移文件');
  if (!raw.products.length || raw.products.length > 500 || raw.assets.length > 1500
    || raw.productCount !== raw.products.length || raw.assetCount !== raw.assets.length)
    throw new Error('产品迁移文件数量不一致或超限');
  const products = raw.products.map((item: unknown): ProductItem => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('产品字段无效');
    const source = item as Record<string, unknown>;
    const product: Record<string, string> = {};
    for (const field of PRODUCT_FIELDS) {
      if (source[field] === undefined || source[field] === null) continue;
      if (typeof source[field] !== 'string' || String(source[field]).length > 5000) throw new Error(`产品字段 ${field} 无效`);
      product[field] = String(source[field]);
    }
    if (!product.name?.trim()) throw new Error('产品缺少名称');
    return { ...product, name: product.name, images: [] };
  });
  const assignedImages: PendingProductImport['assignedImages'] = [];
  for (const item of raw.assets) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('产品图片记录无效');
    const asset = item as Record<string, unknown>;
    const productIndex = Number(asset.productIndex);
    const field = String(asset.field || '');
    const mimeType = String(asset.mimeType || '');
    const sha256 = String(asset.sha256 || '').toLowerCase();
    const name = String(asset.name || 'product-image').slice(0, 160);
    if (!Number.isInteger(productIndex) || productIndex < 0 || productIndex >= products.length || !IMAGE_FIELDS.has(field)
      || !['image/png', 'image/jpeg', 'image/webp'].includes(mimeType) || !/^[a-f0-9]{64}$/.test(sha256)
      || typeof asset.dataBase64 !== 'string') throw new Error('产品图片关联或格式无效');
    const bytes = decodeBase64(asset.dataBase64);
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('产品图片大小无效');
    const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
    const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== sha256) throw new Error(`产品图片校验失败：${name}`);
    const image = new File([bytes as Uint8Array<ArrayBuffer>], name, { type: mimeType });
    assignedImages.push({ productIndex, name, url: URL.createObjectURL(image), file: image, field });
  }
  return { fileName: file.name, sheetName: '产品迁移文件', products, totalRows: products.length, skippedRows: 0,
    sourceLabel: '已校验产品图片与 SHA-256；将绑定到当前登录账号', unassignedImages: [], assignedImages, remoteImageTransfers: {} };
}
