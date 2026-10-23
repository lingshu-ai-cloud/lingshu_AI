import { type Material } from '../routes/studioMaterialProjection.js';
import { buildMaterialCapabilityManifest } from '../../shared/contracts/materialCapabilityManifest.js';
import { readMaterialLibrary } from '../lib/materialLibrary.js';
import fs from 'fs';
import { type ReferenceImage } from '../lib/imageGen.js';
import { materialLocalFile, mimeFromFile } from '../socialImage/studioPosterHelpers.js';
import { fetchCloudMaterial } from '../lib/cloudMaterials.js';
import { objectStorageDownload } from '../storage/objectStorage.js';
import { GENERATED_MEDIA_DIR, MEDIA_DIR } from './runtimeConfig.js';
import type { PosterReferenceRole, PosterReferenceDescriptor } from './contracts.js';
import type { StudioApplicationPorts } from './applicationPorts.js';

export function createPosterReferenceAssets(deps: Pick<StudioApplicationPorts, 'storyboardEnterpriseImage'>) {
  const storyboardEnterpriseImage: StudioApplicationPorts['storyboardEnterpriseImage'] = (...args) => deps.storyboardEnterpriseImage(...args);

  async function posterReferenceBytes(material: Record<string, unknown>, tenantId: string): Promise<ReferenceImage | null> {
    const objectKey = String(material.objectKey || '').trim();
    if (objectKey) {
      const downloaded = await objectStorageDownload(objectKey).catch(() => null);
      if (downloaded?.buf.length) return { mimeType: downloaded.contentType, base64: downloaded.buf.toString('base64') };
    }
    const id = String(material.id || '');
    if (id.startsWith('pb-')) {
      const response = await fetchCloudMaterial(id.slice(3), 'videoFile', undefined, tenantId).catch(() => null);
      if (response?.ok) {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length) return { mimeType: response.headers.get('content-type') || 'image/png', base64: bytes.toString('base64') };
      }
    }
    const local = materialLocalFile(material as unknown as Material, MEDIA_DIR, GENERATED_MEDIA_DIR);
    if (local && fs.existsSync(local)) return { mimeType: mimeFromFile(local), base64: fs.readFileSync(local).toString('base64') };
    const url = String(material.url || '').trim();
    return url ? storyboardEnterpriseImage(url, tenantId) : null;
  }

  async function resolveReferenceImages(
    materialIds: unknown,
    tenantId: string,
    rawReferencePlan: unknown = [],
  ): Promise<{ images: ReferenceImage[]; descriptors: PosterReferenceDescriptor[]; blockers: string[] }> {
    const orderedIds = Array.isArray(materialIds) ? [...new Set(materialIds.map(String).filter(Boolean))].slice(0, 3) : [];
    if (!orderedIds.length) return { images: [], descriptors: [], blockers: ['没有选择可用于图片生成的参考素材'] };
    const roles = new Map<string, PosterReferenceRole>();
    if (Array.isArray(rawReferencePlan)) {
      for (const raw of rawReferencePlan) {
        const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
        const role = String(row.role || '');
        if (['exact_product', 'style', 'supporting'].includes(role)) roles.set(String(row.materialId || ''), role as PosterReferenceRole);
      }
    }
    const inventory = await readMaterialLibrary(tenantId);
    const byId = new Map(inventory.items.map(item => [String(item.id), item]));
    const images: ReferenceImage[] = [];
    const descriptors: PosterReferenceDescriptor[] = [];
    const blockers: string[] = [];
    for (const materialId of orderedIds) {
      const material = byId.get(materialId);
      if (!material) { blockers.push(`素材 ${materialId} 不存在或已失去访问权限`); continue; }
      if (material.type !== 'image') { blockers.push(`素材 ${materialId} 不是图片`); continue; }
      const manifest = buildMaterialCapabilityManifest(material);
      if (!manifest.capabilities.includes('image_generation_reference')) {
        const reason = manifest.blockers.map(item => item.message).join('、') || '未通过图片模型输入准入';
        blockers.push(`${material.name || materialId}：${reason}`);
        continue;
      }
      const inferredRole: PosterReferenceRole = manifest.capabilities.includes('exact_product_reference')
        ? 'exact_product'
        : material.usage === 'reference_only' || material.folder === 'hot' ? 'style' : 'supporting';
      const role = roles.get(materialId) || inferredRole;
      if (role === 'exact_product' && !manifest.capabilities.includes('exact_product_reference')) {
        blockers.push(`${material.name || materialId} 没有明确产品绑定，不能作为产品身份图`);
        continue;
      }
      const bytes = await posterReferenceBytes(material, tenantId).catch(() => null);
      if (!bytes) { blockers.push(`${material.name || materialId} 的原始图片不可读取`); continue; }
      images.push(bytes);
      descriptors.push({ materialId, role, productId: manifest.identity.productId });
    }
    return { images, descriptors, blockers };
  }

  return { resolveReferenceImages };
}
