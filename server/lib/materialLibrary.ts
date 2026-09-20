import fs from 'node:fs';
import path from 'node:path';
import { readCloudMaterialLibrary, type MaterialSourceStatus } from './cloudMaterials.js';
import { isSyntheticMaterial } from './materialTruthfulness.js';
export type MaterialRecord = Record<string, any> & { id: string };

export interface SocialTaskMaterialRecordInput {
  id: string;
  tenantId: string;
  taskId: string;
  taskFileRef: string;
  contentSha256: string;
  productRef?: string | null;
  record: MaterialRecord;
}
export function materialLibraryFile() { return path.resolve(process.cwd(), 'data', 'materials.json'); }
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
  const productRef = String(input.productRef || '').trim();
  const productRefs = Array.from(new Set([
    ...(index >= 0 && Array.isArray(records[index]!.productRefs) ? records[index]!.productRefs : []),
    productRef,
  ].map(value => String(value || '').trim()).filter(Boolean)));
  const associations = { sourceTaskIds: taskIds, sourceTaskFileRefs: taskFileRefs, productRefs };
  if (index >= 0) {
    const current = records[index]!;
    const next: MaterialRecord = {
      ...current,
      ...associations,
      // productRef is currently free text in the social brief, so keep it as
      // productName compatibility data and as an explicit future-proof field.
      ...(productRef ? { productRef, productName: productRef } : {}),
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
    ...(productRef ? { productRef, productName: productRef } : {}),
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
export function accessibleMaterial(item: MaterialRecord, tenantId: string): boolean {
  return !isSyntheticMaterial(item) && (item.scope === 'shared' || String(item.tenantId || item.tenant_id || '') === tenantId);
}
/** The UI and worker share this inventory; source failures are never reported as an empty library. */
export async function readMaterialLibrary(tenantId: string, adapters: {
  local?: typeof readLocalMaterials; cloud?: typeof readCloudMaterialLibrary;
} = {}): Promise<{ items: MaterialRecord[]; status: 'ready' | 'partial' | 'unavailable'; sources: MaterialSourceStatus[] }> {
  let local: MaterialRecord[] = [];
  let localStatus: MaterialSourceStatus = { source: 'server', state: 'ready', message: '服务端素材目录可用' };
  try { local = (adapters.local || readLocalMaterials)(); }
  catch { localStatus = { source: 'server', state: 'unavailable', message: '服务端素材目录读取失败，请重试或联系管理员' }; }
  const cloud = await (adapters.cloud || readCloudMaterialLibrary)(tenantId);
  const sources = [localStatus, cloud.source];
  const items = [...new Map([...local, ...cloud.items].filter(item => accessibleMaterial(item as MaterialRecord, tenantId)).map(item => [String(item.id), item as MaterialRecord])).values()];
  const ready = sources.filter(source => source.state === 'ready').length;
  return { items, sources, status: ready === sources.length ? 'ready' : ready ? 'partial' : 'unavailable' };
}
