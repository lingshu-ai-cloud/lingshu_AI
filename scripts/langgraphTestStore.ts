import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DataStore, ListQuery, ListResult, Record_, CompareExpected } from '../server/storage/datastore.js';

/** Isolated disk persistence for sequential subprocess acceptance tests.
 * Not a production database or evidence of concurrent database arbitration. */
export class LangGraphTestStore implements DataStore {
  constructor(readonly filename: string) { mkdirSync(path.dirname(filename), { recursive: true }); }
  supportsAtomicCompareAndSwap() { return true; }
  supportsAtomicOperationLease() { return true; }
  private read(): Record<string, Record_[]> { return existsSync(this.filename) ? JSON.parse(readFileSync(this.filename, 'utf8')) : {}; }
  private write(rows: Record<string, Record_[]>) {
    const temp = `${this.filename}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(rows)); renameSync(temp, this.filename);
  }
  async getById<T = Record_>(collection: string, id: string): Promise<T | null> {
    return structuredClone(this.read()[collection]?.find(row => row.id === id) ?? null) as T | null;
  }
  async create<T = Record_>(collection: string, data: Record<string, unknown>): Promise<T | null> {
    const rows = this.read(); const bucket = rows[collection] ??= [];
    const uniqueKeys = collection === 'durable_operation_leases' ? ['tenant_id', 'lease_scope', 'subject_id']
      : collection === 'starter_social_content_operations' ? ['tenant_id', 'idempotency_key']
        : collection === 'starter_social_content_tasks' ? ['tenant_id', 'create_idempotency_key'] : null;
    if (uniqueKeys && bucket.some(row => uniqueKeys.every(key => row[key] === data[key]))) return null;
    if (data.id && bucket.some(row => row.id === data.id)) return null;
    const row = { ...structuredClone(data), id: String(data.id ?? randomUUID()) };
    bucket.push(row); this.write(rows); return structuredClone(row) as T;
  }
  async update(collection: string, id: string, data: Record<string, unknown>) {
    const rows = this.read(); const row = rows[collection]?.find(item => item.id === id);
    if (!row) return false; Object.assign(row, structuredClone(data)); this.write(rows); return true;
  }
  async compareAndSwap(collection: string, id: string, expected: CompareExpected, data: Record<string, unknown>) {
    const rows = this.read(); const row = rows[collection]?.find(item => item.id === id);
    if (!row || !Object.entries(expected).every(([key, value]) => JSON.stringify(row[key]) === JSON.stringify(value))) return false;
    Object.assign(row, structuredClone(data)); this.write(rows); return true;
  }
  async delete(collection: string, id: string) {
    const rows = this.read(); const bucket = rows[collection] ?? [];
    const index = bucket.findIndex(row => row.id === id); if (index < 0) return false;
    bucket.splice(index, 1); this.write(rows); return true;
  }
  async list<T = Record_>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    let items = (this.read()[collection] ?? []).filter(row => Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value));
    if (query.sort) for (const column of query.sort.split(',').reverse()) {
      const descending = column.startsWith('-'), key = descending ? column.slice(1) : column;
      items.sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * (descending ? -1 : 1));
    }
    const totalItems = items.length, page = query.page ?? 1, perPage = query.perPage ?? 500;
    return { items: structuredClone(items.slice((page - 1) * perPage, page * perPage)) as T[], totalItems, totalPages: Math.ceil(totalItems / perPage), page, perPage };
  }
}
