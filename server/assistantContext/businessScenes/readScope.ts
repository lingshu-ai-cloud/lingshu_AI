import type { DataStore, Record_ } from '../../storage/datastore.js';
export class BusinessSceneError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}
export const object = (v: unknown): Record<string, unknown> => {
  if (typeof v === 'string') { try { return object(JSON.parse(v)); } catch { return {}; } }
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
};
export const text = (v: unknown, max = 2000) => typeof v === 'string' ? v.slice(0, max) : '';
export function pick(row: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.flatMap(k => { const v = row[k]; return ['string', 'number', 'boolean'].includes(typeof v) || v === null ? [[k, typeof v === 'string' ? v.slice(0, 4000) : v]] : []; }));
}
/** All pages or an explicit incomplete state. Never aggregate the first page as a tenant total. */
export async function scanTenantRecords(data: Pick<DataStore, 'list'>, collection: string, tenantId: string, tenantKey = 'tenant_id', maxRows = 10000) {
  const rows: Record_[] = [], ids = new Set<string>(); let total: number | undefined;
  for (let page = 1; page <= 100; page++) {
    const r = await data.list<Record_>(collection, { where: { [tenantKey]: tenantId }, page, perPage: 200, sort: 'id' });
    if (!Number.isSafeInteger(r.totalItems) || r.totalItems < 0 || total !== undefined && total !== r.totalItems || r.totalItems > maxRows) throw new BusinessSceneError('scene_scan_incomplete', 409, '记录过多或查询期间发生变化，请缩小对象范围后重试。');
    total = r.totalItems;
    for (const row of r.items) {
      if (row[tenantKey] !== tenantId || !row.id || ids.has(row.id)) throw new BusinessSceneError('scene_scope_invalid', 503, '数据归属或分页校验未通过。');
      ids.add(row.id); rows.push(row);
    }
    if (rows.length === total) return rows;
    if (!r.items.length || rows.length > total) break;
  }
  throw new BusinessSceneError('scene_scan_incomplete', 409, '记录分页尚不完整，请稍后重试。');
}
export function inWindow(value: unknown, from: string, to: string) {
  const timestamp = typeof value === 'number' ? value : Date.parse(String(value || ''));
  return Number.isFinite(timestamp) && timestamp >= Date.parse(`${from}T00:00:00+08:00`) && timestamp < Date.parse(`${to}T00:00:00+08:00`) + 86400000;
}
