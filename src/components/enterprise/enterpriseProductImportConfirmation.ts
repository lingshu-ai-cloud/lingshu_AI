import type { ProductItem } from './enterpriseProfileTypes';
import type { PendingProductImport } from './enterpriseProductImportPreparation';

type UploadedAsset = { name: string; type: string; size: number; updatedAt: string; url?: string };
export interface ProductImportAssetPorts {
  upload(file: File): Promise<UploadedAsset>;
  importUrl(url: string, name: string): Promise<UploadedAsset>;
}
export type ProductImportAssetResult =
  | { status: 'ready'; pending: PendingProductImport }
  | { status: 'blocked'; pending: PendingProductImport; message: string };

export async function confirmEnterpriseProductImportAssets(
  source: PendingProductImport,
  ports: ProductImportAssetPorts,
  onProgress: (pending: PendingProductImport) => void = () => {},
): Promise<ProductImportAssetResult> {
  const products: ProductItem[] = source.products.map(product => ({ ...product, images: [...(product.images || [])] }));
  const assignedImages = [...source.assignedImages];
  let pending: PendingProductImport = { ...source, products, assignedImages };
  const publish = (patch: Partial<PendingProductImport>) => {
    pending = { ...pending, ...patch };
    onProgress(pending);
  };

  try {
    for (const [imageIndex, image] of assignedImages.entries()) {
      const product = products[image.productIndex];
      if (!product) continue;
      const asset = image.uploadedUrl
        ? { name: image.name, type: image.file.type, size: image.file.size, updatedAt: new Date().toISOString(), url: image.uploadedUrl }
        : await ports.upload(image.file);
      if (!asset.url) throw new Error('PDF 产品图片上传后缺少可用地址');
      assignedImages[imageIndex] = { ...image, uploadedUrl: asset.url };
      const field = image.field || 'images';
      if (field === 'imageUrl') product.imageUrl = asset.url;
      else if (['images', 'packagingImages', 'factoryImages', 'certificateImages', 'sceneImages', 'brandAssets'].includes(field)) {
        const key = field as 'images' | 'packagingImages' | 'factoryImages' | 'certificateImages' | 'sceneImages' | 'brandAssets';
        product[key] = [...(product[key] || []).filter(existing => existing.url !== asset.url), asset];
      }
      if (!product.imageUrl) product.imageUrl = asset.url;
      publish({ assignedImages: [...assignedImages] });
    }
  } catch (error) {
    return { status: 'blocked', pending, message: error instanceof Error ? error.message : 'PDF 产品图片上传失败' };
  }

  const remoteImageTransfers = { ...source.remoteImageTransfers };
  publish({ remoteImageTransfers: Object.fromEntries(Object.entries(remoteImageTransfers).map(([index, transfer]) => [index, transfer.status === 'uploaded' ? transfer : { ...transfer, status: 'uploading', error: undefined }])) });
  await Promise.all(Object.entries(remoteImageTransfers).map(async ([indexText, transfer]) => {
    if (transfer.status === 'uploaded') return;
    const index = Number(indexText);
    try {
      const asset = await ports.importUrl(transfer.originalUrl, `${products[index]?.name || '产品'}-主图`);
      const product = products[index];
      if (product) {
        product.imageUrl = asset.url;
        product.images = [{ ...asset }, ...(product.images || []).filter(image => image.url !== transfer.originalUrl)];
      }
      remoteImageTransfers[index] = { ...transfer, status: 'uploaded', error: undefined };
    } catch (error) {
      remoteImageTransfers[index] = { ...transfer, status: 'failed', error: error instanceof Error ? error.message : '外链图片转存失败' };
    }
  }));
  publish({ products, remoteImageTransfers });
  const failedTransfers = Object.values(remoteImageTransfers).filter(transfer => transfer.status === 'failed');
  if (failedTransfers.length) return { status: 'blocked', pending, message: `${failedTransfers.length} 张产品外链图片转存失败，产品尚未导入。请检查图片地址后重试。` };

  const unassignedImages = source.unassignedImages.map(image => image.status === 'uploaded' ? image : { ...image, status: 'uploading' as const, error: undefined });
  publish({ unassignedImages });
  const settled = await Promise.all(unassignedImages.map(async image => {
    if (image.status === 'uploaded') return image;
    try {
      await ports.upload(image.file);
      return { ...image, status: 'uploaded' as const, error: undefined };
    } catch (error) {
      return { ...image, status: 'failed' as const, error: error instanceof Error ? error.message : '图片上传失败' };
    }
  }));
  publish({ unassignedImages: settled });
  const failed = settled.filter(image => image.status === 'failed');
  if (failed.length) return { status: 'blocked', pending, message: `${failed.length} 张未归属图片上传失败，产品尚未导入。请重试或取消导入。` };
  return { status: 'ready', pending };
}
