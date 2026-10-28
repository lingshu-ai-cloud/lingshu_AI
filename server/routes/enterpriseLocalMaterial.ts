import { randomUUID } from 'node:crypto';
import { readLocalMaterials, saveLocalMaterials } from '../lib/materialLibrary.js';
import type { MaterialAssetV2Metadata } from '../../shared/contracts/materialAssetV2.js';

export function upsertLocalEnterpriseMaterial(input: {
  tenantId: string; title: string; type: 'image' | 'video' | 'audio'; sizeBytes: number;
  duration?: number; width?: number; height?: number; sha256: string; sourceUrl: string;
  sourceName: string; productId?: string; objectKey?: string; file?: string; sourceType?: string;
  materialV2?: MaterialAssetV2Metadata; provenance: Record<string, unknown>;
}): Record<string, unknown> {
  const records = readLocalMaterials();
  const index = records.findIndex(item => String(item.tenantId || item.tenant_id || '') === input.tenantId
    && String(item.contentSha256 || item.sha256 || '').toLowerCase() === input.sha256.toLowerCase());
  const now = new Date().toISOString(), sourceEntries = ['enterprise_knowledge'];
  if (index >= 0) {
    const current = records[index]!;
    if (input.productId) {
      if (current.productId && String(current.productId) !== input.productId) throw new Error('enterprise_product_image_hash_product_conflict');
      records[index] = { ...current, productId: input.productId,
        ...(input.file ? { file: input.file } : {}), ...(input.objectKey ? { objectKey: input.objectKey } : {}),
        ...(input.materialV2 ? { materialV2: input.materialV2 } : {}),
        provenance: { ...(current.provenance || {}), ...input.provenance,
          ...(input.materialV2 ? { materialAssetV2: input.materialV2 } : {}) }, updatedAt: now };
      saveLocalMaterials(records);
      return records[index]!;
    }
    if (String(current.productId || '')) return current;
    const currentProvenance = current.provenance && typeof current.provenance === 'object' ? current.provenance : {};
    records[index] = { ...current, sourceUrl: input.sourceUrl,
      provenance: { ...currentProvenance, ...input.provenance, sourceEntry: 'enterprise_knowledge', sourceEntries }, updatedAt: now };
    saveLocalMaterials(records);
    return records[index]!;
  }
  const created = {
    id: `enterprise-${randomUUID()}`, tenantId: input.tenantId, name: input.title, title: input.title,
    folder: 'enterprise-upload', type: input.type, duration: input.duration || 0,
    width: input.width, height: input.height, sizeBytes: input.sizeBytes, size: `${input.sizeBytes} B`,
    contentSha256: input.sha256, sha256: input.sha256, scope: 'own', usage: 'editable',
    sourceType: input.sourceType || 'enterprise_upload', sourceName: input.sourceName, sourceProvider: 'tenant',
    sourceUrl: input.sourceUrl, url: input.sourceUrl, ...(input.objectKey ? { objectKey: input.objectKey } : {}),
    ...(input.file ? { file: input.file } : {}), ...(input.materialV2 ? { materialV2: input.materialV2 } : {}),
    ...(input.productId ? { productId: input.productId } : {}), sourceEntry: 'enterprise_knowledge',
    ownership: 'enterprise', visibility: 'tenant', knowledgeEligible: true,
    provenance: { ...input.provenance, ...(input.materialV2 ? { materialAssetV2: input.materialV2 } : {}),
      sourceEntry: 'enterprise_knowledge', sourceEntries }, createdAt: now, updatedAt: now,
  };
  records.push(created);
  saveLocalMaterials(records);
  return created;
}
