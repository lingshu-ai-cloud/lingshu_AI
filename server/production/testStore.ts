import type { DataStore, ListQuery } from '../storage/datastore.js';

/** Small backend-neutral store used only by production-domain tests. */
export function createProductionTestStore(): DataStore & { rows: Map<string, Record<string, unknown>> } {
  const rows = new Map<string, Record<string, unknown>>();
  let counter = 0;
  return {
    rows,
    async getById<T>(collection: string, id: string) {
      return structuredClone(rows.get(`${collection}/${id}`) || null) as T | null;
    },
    async create<T>(collection: string, data: Record<string, unknown>) {
      if (collection === 'production_input_requests') {
        const duplicate = [...rows.entries()].some(([key, row]) => key.startsWith(`${collection}/`)
          && row.tenant_id === data.tenant_id && row.dedupe_key === data.dedupe_key);
        if (duplicate) return null;
      }
      if (collection === 'production_cost_quotes') {
        const duplicate = [...rows.entries()].some(([key, row]) => key.startsWith(`${collection}/`)
          && row.tenant_id === data.tenant_id && row.quote_key === data.quote_key);
        if (duplicate) return null;
      }
      const id = `record-${++counter}`;
      const row = { ...structuredClone(data), id };
      rows.set(`${collection}/${id}`, row);
      return structuredClone(row) as T;
    },
    async update(collection: string, id: string, data: Record<string, unknown>) {
      const key = `${collection}/${id}`;
      const row = rows.get(key);
      if (!row) return false;
      rows.set(key, { ...row, ...structuredClone(data) });
      return true;
    },
    async delete(collection: string, id: string) { return rows.delete(`${collection}/${id}`); },
    async list<T>(collection: string, query: ListQuery = {}) {
      const where = query.where || {};
      let items = [...rows.entries()]
        .filter(([key, row]) => key.startsWith(`${collection}/`)
          && Object.entries(where).every(([field, expected]) => row[field] === expected))
        .map(([, row]) => structuredClone(row) as T);
      const sort = query.sort;
      if (sort) {
        const descending = sort.startsWith('-');
        const field = descending ? sort.slice(1) : sort;
        items = items.sort((left, right) => String((left as Record<string, unknown>)[field] || '')
          .localeCompare(String((right as Record<string, unknown>)[field] || '')) * (descending ? -1 : 1));
      }
      const perPage = query.perPage || 30;
      const page = query.page || 1;
      const start = (page - 1) * perPage;
      return {
        items: items.slice(start, start + perPage),
        totalItems: items.length,
        totalPages: Math.max(1, Math.ceil(items.length / perPage)),
        page,
        perPage,
      };
    },
  };
}
