import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readCloudMaterialLibrary, type MaterialSourceStatus } from './cloudMaterials.js';
import { isSyntheticMaterial } from './materialTruthfulness.js';
import type { DataStore } from '../storage/datastore.js';
import { tenantCatalogImageFile } from './enterpriseMediaImage.js';
import sharp from 'sharp';
export type MaterialRecord = Record<string, any> & { id: string };

/**
 * A referenced production asset may be removed from the user's library while
 * its immutable bytes remain available to the project that already uses it.
 * Production reads explicitly request purpose=all; every user-facing library
 * purpose must hide the removed record.
 */
export function materialVisibleForPurpose(material: MaterialRecord, purpose: string): boolean {
  return purpose === 'all' || !String(material.libraryRemovedAt || '').trim();
}

export function hideLocalMaterialFromLibrary(
  records: MaterialRecord[],
  materialId: string,
  tenantId: string,
  removedAt: string,
): { records: MaterialRecord[]; material?: MaterialRecord } {
  let hidden: MaterialRecord | undefined;
  const next = records.map(record => {
    if (record.id !== materialId || String(record.tenantId || record.tenant_id || '') !== tenantId || record.scope === 'shared') return record;
    hidden = { ...record, libraryRemovedAt: removedAt };
    return hidden;
  });
  return { records: next, material: hidden };
}

export interface SocialTaskMaterialRecordInput {
  id: string;
  tenantId: string;
  taskId: string;
  taskFileRef: string;
  contentSha256: string;
  productId?: string | null;
  productRef?: string | null;
  productName?: string | null;
  record: MaterialRecord;
}
export function materialLibraryFile() {
  const configured = String(process.env.MATERIAL_LIBRARY_FILE || '').trim();
  return configured ? path.resolve(configured) : path.resolve(process.cwd(), 'data', 'materials.json');
}
export function readLocalMaterials(): MaterialRecord[] {
  const file = materialLibraryFile();
  if (!fs.existsSync(file)) return [];
  const records = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(records)) throw Error('素材目录格式无效');
  return records;
}
export function saveLocalMaterials(records: MaterialRecord[]) {
  const file = materialLibraryFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(records, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

/**
 * Make a task-uploaded creative asset visible in the same inventory used by
 * "My Materials". The content hash is the tenant-local identity: uploading
 * the same bytes from another task reuses one material record while retaining
 * every task/product association for later migration to a relational model.
 */
export function upsertSocialTaskMaterial(input: SocialTaskMaterialRecordInput): MaterialRecord {
  const sha256 = String(input.contentSha256 || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('invalid social task material hash');
  const records = readLocalMaterials();
  const index = records.findIndex(item => (
    String(item.tenantId || item.tenant_id || '') === input.tenantId
    && String(item.contentSha256 || '').toLowerCase() === sha256
  ));
  const taskIds = Array.from(new Set([
    ...(index >= 0 && Array.isArray(records[index]!.sourceTaskIds) ? records[index]!.sourceTaskIds : []),
    input.taskId,
  ].map(value => String(value || '').trim()).filter(Boolean)));
  const taskFileRefs = Array.from(new Set([
    ...(index >= 0 && Array.isArray(records[index]!.sourceTaskFileRefs) ? records[index]!.sourceTaskFileRefs : []),
    input.taskFileRef,
  ].map(value => String(value || '').trim()).filter(Boolean)));
  const productId = String(input.productId || '').trim();
  const productName = String(input.productName || '').trim();
  const productRef = String(input.productRef || productName || productId).trim();
  const productRefs = Array.from(new Set([
    ...(index >= 0 && Array.isArray(records[index]!.productRefs) ? records[index]!.productRefs : []),
    productRef,
  ].map(value => String(value || '').trim()).filter(Boolean)));
  const associations = { sourceTaskIds: taskIds, sourceTaskFileRefs: taskFileRefs, productRefs };
  if (index >= 0) {
    const current = records[index]!;
    const enterpriseMetadata = input.record.sourceType === 'enterprise_product_table' ? {
      width: input.record.width,
      height: input.record.height,
      licenseEvidence: input.record.licenseEvidence,
      rightsEvidenceRef: input.record.rightsEvidenceRef,
      rightsStatus: input.record.rightsStatus,
      commercialUseApproved: input.record.commercialUseApproved,
      sourceRevision: input.record.sourceRevision,
      provenance: input.record.provenance,
    } : {};
    const next: MaterialRecord = {
      ...current,
      ...enterpriseMetadata,
      ...associations,
      ...(productRef ? { productRef } : {}),
      ...(productId ? { productId } : {}),
      ...(productName ? { productName } : {}),
      updatedAt: new Date().toISOString(),
    };
    records[index] = next;
    saveLocalMaterials(records);
    return next;
  }
  const created: MaterialRecord = {
    ...input.record,
    id: input.id,
    tenantId: input.tenantId,
    contentSha256: sha256,
    ...associations,
    ...(productRef ? { productRef } : {}),
    ...(productId ? { productId } : {}),
    ...(productName ? { productName } : {}),
  };
  records.push(created);
  saveLocalMaterials(records);
  return created;
}
export function updateLocalMaterial(id: string, tenantId: string, patch: Record<string, unknown>): boolean {
  const records = readLocalMaterials();
  const index = records.findIndex(item => item.id === id && String(item.tenantId || item.tenant_id || '') === tenantId);
  if (index < 0) return false;
  records[index] = { ...records[index], ...patch, id: records[index].id, tenantId, updatedAt: new Date().toISOString() };
  saveLocalMaterials(records); return true;
}
/** Internal Director analysis may enrich any material already visible to the
 * tenant, including shared library rows. It never changes file ownership. */
export function updateAccessibleLocalMaterial(id: string, tenantId: string, patch: Record<string, unknown>): boolean {
  const records = readLocalMaterials();
  const index = records.findIndex(item => item.id === id && accessibleMaterial(item, tenantId));
  if (index < 0) return false;
  records[index] = { ...records[index], ...patch, id: records[index]!.id, updatedAt: new Date().toISOString() };
  saveLocalMaterials(records);
  return true;
}
export function accessibleMaterial(item: MaterialRecord, tenantId: string): boolean {
  return !isSyntheticMaterial(item) && (item.scope === 'shared' || String(item.tenantId || item.tenant_id || '') === tenantId);
}

/** Project tenant-owned Enterprise Center product images into the same read-only
 * inventory used by planning and production. The file hash is recomputed from
 * the current bytes on every read, so a changed or missing catalog asset cannot
 * inherit an earlier product identity authorization. */
async function enterpriseProductImageMaterials(tenantId: string, dataStore?: DataStore): Promise<MaterialRecord[]> {
  if (!dataStore) return [];
  const rows = await dataStore.list<Record<string, unknown>>('tenant_profiles', {
    where: { tenant_id: tenantId }, page: 1, perPage: 2,
  });
  if (rows.totalItems > 1 || rows.items.some(row => row.tenant_id !== tenantId)) throw new Error('enterprise_product_inventory_scope_invalid');
  const raw = rows.items[0]?.profile;
  let profile: Record<string, unknown> | null = null;
  try { profile = typeof raw === 'string' ? JSON.parse(raw) as Record<string, unknown> : raw && typeof raw === 'object' ? raw as Record<string, unknown> : null; }
  catch { return []; }
  const products = profile?.products && typeof profile.products === 'object' ? profile.products as Record<string, unknown> : null;
  const items = Array.isArray(products?.items) ? products.items : [];
  const mediaRoot = path.resolve(process.env.SOCIAL_CONTENT_MEDIA_ROOT || path.join(process.cwd(), 'data/media'));
  const result: MaterialRecord[] = [];
  for (const [productIndex, value] of items.entries()) {
    if (!value || typeof value !== 'object') continue;
    const product = value as Record<string, unknown>;
    const productId = String(product.id || product.productId || product.sku || `product-${productIndex}`).trim();
    const productName = String(product.name || product.sku || productId).trim();
    const assets = [
      ...(String(product.imageUrl || '').trim() ? [{ url: product.imageUrl, name: `${productName}主图` }] : []),
      ...(Array.isArray(product.images) ? product.images : []),
      ...(Array.isArray(product.packagingImages) ? product.packagingImages : []),
    ];
    const seen = new Set<string>();
    for (const [assetIndex, asset] of assets.entries()) {
      if (!asset || typeof asset !== 'object') continue;
      const row = asset as Record<string, unknown>, url = String(row.url || '').trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const file = tenantCatalogImageFile(url, tenantId, mediaRoot);
      if (!file) continue;
      const bytes = fs.readFileSync(file), contentSha256 = createHash('sha256').update(bytes).digest('hex');
      const metadata = await sharp(bytes).metadata();
      if (!metadata.width || !metadata.height) continue;
      const relative = decodeURIComponent(new URL(url, 'http://local.invalid').pathname).replace(/^\/media\//, '');
      const licenseEvidence = `enterprise_profile:${rows.items[0]?.id || 'profile'}:product:${productId}`;
      result.push({
        id: `enterprise-product-${createHash('sha256').update(`${tenantId}\0${productId}\0${url}`).digest('hex').slice(0, 24)}`,
        tenantId, type: 'image', name: String(row.name || `${productName}图片 ${assetIndex + 1}`),
        folder: 'product', scope: 'own', usage: 'editable', url, file: relative,
        sourceType: 'enterprise_product_table', source: 'tenant_enterprise_profile',
        productId, productRef: `product:${productId}`, productRefs: [`product:${productId}`, productName], productName,
        contentSha256, contentHash: contentSha256, sourceRevision: contentSha256,
        width: metadata.width, height: metadata.height,
        rightsStatus: 'authorized', rightsEvidenceRef: licenseEvidence, licenseEvidence, commercialUseApproved: true,
        createdAt: String(row.updatedAt || new Date(0).toISOString()),
      } satisfies MaterialRecord);
    }
  }
  return result;
}
/** The UI and worker share this inventory; source failures are never reported as an empty library. */
export async function readMaterialLibrary(tenantId: string, adapters: {
  local?: typeof readLocalMaterials; cloud?: typeof readCloudMaterialLibrary; dataStore?: DataStore;
} = {}): Promise<{ items: MaterialRecord[]; status: 'ready' | 'partial' | 'unavailable'; sources: MaterialSourceStatus[] }> {
  let local: MaterialRecord[] = [];
  let localStatus: MaterialSourceStatus = { source: 'server', state: 'ready', message: '服务端素材目录可用' };
  try { local = (adapters.local || readLocalMaterials)(); }
  catch { localStatus = { source: 'server', state: 'unavailable', message: '服务端素材目录读取失败，请重试或联系管理员' }; }
  // readCloudMaterialLibrary follows the request's bound data authority. In a
  // local-authenticated preview it reads the local DataStore, so uploaded
  // object-backed materials remain visible without attempting PocketBase.
  const cloud = await (adapters.cloud || readCloudMaterialLibrary)(tenantId, undefined, adapters.dataStore);
  const sources = [localStatus, cloud.source];
  let enterpriseProducts: MaterialRecord[] = [];
  try { enterpriseProducts = await enterpriseProductImageMaterials(tenantId, adapters.dataStore); }
  catch { sources.push({ source: 'database', state: 'unavailable', message: '企业产品图库读取失败，请重试或联系管理员' }); }
  const items = [...new Map([...local, ...cloud.items, ...enterpriseProducts].filter(item => accessibleMaterial(item as MaterialRecord, tenantId)).map(item => [String(item.id), item as MaterialRecord])).values()];
  const ready = sources.filter(source => source.state === 'ready').length;
  return { items, sources, status: ready === sources.length ? 'ready' : ready ? 'partial' : 'unavailable' };
}
