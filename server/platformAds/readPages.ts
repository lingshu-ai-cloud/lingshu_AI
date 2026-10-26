import { store } from '../storage/index.js';
import type { Record_ } from '../storage/datastore.js';
/** Opt-in exhaustive read for analysis; existing workspace list limits remain unchanged. */
export async function readAdRows<T>(collection: string, tenantId: string, taskId: string | undefined, allPages: boolean, sort?: string): Promise<T[]> {
  const rows: T[] = [], seen = new Set<string>(); let total: number | undefined;
  for (let page = 1; page <= 100; page++) {
    const result = await store.list<T>(collection, { where: { tenant_id: tenantId, ...(taskId ? { taskId } : {}) }, perPage: 200, ...(sort ? { sort } : {}), ...(allPages ? { page } : {}) });
    if (!allPages) return result.items;
    if (!Number.isSafeInteger(result.totalItems) || result.totalItems < 0 || result.totalItems > 20000 || total !== undefined && total !== result.totalItems) throw Error('ad_read_pagination_incomplete');
    total = result.totalItems;
    for (const item of result.items) {
      const row = item as Record_;
      if (!row.id || row.tenant_id !== tenantId || taskId && row.taskId !== taskId || seen.has(row.id)) throw Error('ad_read_scope_invalid');
      seen.add(row.id); rows.push(item);
    }
    if (rows.length === total) return rows;
    if (!result.items.length || rows.length > total) break;
  }
  throw Error('ad_read_pagination_incomplete');
}
