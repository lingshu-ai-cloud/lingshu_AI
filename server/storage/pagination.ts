import type { DataStore, ListQuery, Record_ } from './datastore.js';

export class RecordScanLimitError extends Error {
  constructor(collection: string, totalItems: number, maxRecords: number) {
    super(`record_scan_limit_exceeded:${collection}:${totalItems}:${maxRecords}`);
    this.name = 'RecordScanLimitError';
  }
}

/**
 * Exhaust an equality-filtered PocketBase result without silently treating the
 * first page as the whole collection. A hard limit fails visibly instead of
 * hiding safety work (approvals, cancellation fences, or reconciliation).
 */
export async function listAllRecords<T extends Record_>(input: {
  store: DataStore;
  collection: string;
  query?: Omit<ListQuery, 'page' | 'perPage' | 'skipTotal'>;
  pageSize?: number;
  maxRecords?: number;
}): Promise<T[]> {
  const pageSize = Math.max(1, Math.min(500, Math.floor(input.pageSize || 500)));
  const maxRecords = Math.max(pageSize, Math.floor(input.maxRecords || 250_000));
  const records: T[] = [];
  const seen = new Set<string>();
  for (let page = 1; ; page += 1) {
    const result = await input.store.list<T>(input.collection, { ...input.query, page, perPage: pageSize });
    if (result.totalItems > maxRecords) throw new RecordScanLimitError(input.collection, result.totalItems, maxRecords);
    for (const record of result.items) {
      if (!record.id || seen.has(record.id)) continue;
      seen.add(record.id);
      records.push(record);
    }
    if (records.length >= result.totalItems || page >= result.totalPages || result.items.length === 0) break;
  }
  return records;
}

export function nextFairPage(current: number, totalPages: number): number {
  const total = Math.max(1, Math.floor(totalPages || 1));
  const normalized = Math.max(1, Math.floor(current || 1));
  return normalized >= total ? 1 : normalized + 1;
}
