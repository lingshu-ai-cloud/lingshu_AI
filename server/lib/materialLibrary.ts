import fs from 'node:fs';
import path from 'node:path';
import { readCloudMaterialLibrary, type MaterialSourceStatus } from './cloudMaterials.js';
import { isSyntheticMaterial } from './materialTruthfulness.js';
export type MaterialRecord = Record<string, any> & { id: string };
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
