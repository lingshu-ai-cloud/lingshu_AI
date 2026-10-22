import type { UploadedProductAsset } from '../../lib/enterpriseProductAssetUpload';
import type { ProductAsset } from './enterpriseProfileTypes';

export interface ProductDocumentUploadResult {
  confirmed: ProductAsset[];
  unresolvedNames: string[];
  skippedCount: number;
}

export function mergeConfirmedProductDocuments(
  existing: readonly ProductAsset[],
  confirmed: readonly ProductAsset[],
  maxDocuments: number,
): ProductAsset[] {
  const merged = [...existing];
  const urls = new Set(existing.map(item => item.url).filter(Boolean));
  for (const asset of confirmed) {
    if (!asset.url || urls.has(asset.url) || merged.length >= maxDocuments) continue;
    urls.add(asset.url);
    merged.push(asset);
  }
  return merged;
}

export async function uploadEnterpriseProductDocuments(
  files: readonly File[],
  existingCount: number,
  maxDocuments: number,
  upload: (file: File) => Promise<UploadedProductAsset>,
): Promise<ProductDocumentUploadResult> {
  const available = Math.max(0, maxDocuments - existingCount);
  const selected = files.slice(0, available);
  const settled = await Promise.allSettled(selected.map(file => upload(file)));
  const confirmed: ProductAsset[] = [];
  const unresolvedNames: string[] = [];

  settled.forEach((result, index) => {
    const asset = result.status === 'fulfilled' ? result.value : null;
    if (asset && typeof asset.url === 'string' && asset.url.trim()) {
      confirmed.push(asset);
    } else {
      unresolvedNames.push(selected[index]!.name);
    }
  });

  return { confirmed, unresolvedNames, skippedCount: files.length - selected.length };
}
