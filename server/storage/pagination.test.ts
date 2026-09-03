import assert from 'node:assert/strict';
import type { DataStore, ListQuery, ListResult, Record_ } from './datastore.js';
import { listAllRecords, nextFairPage, RecordScanLimitError } from './pagination.js';

const rows = Array.from({ length: 501 }, (_, index) => ({ id: `row-${String(index).padStart(3, '0')}`, tenant: 't1' }));
const memoryStore = {
  async list<T = Record_>(_collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    const page = query.page || 1;
    const perPage = query.perPage || 30;
    const filtered = rows.filter(row => !query.where || Object.entries(query.where).every(([key, value]) => String(row[key as keyof typeof row]) === String(value)));
    return { items: filtered.slice((page - 1) * perPage, page * perPage) as T[], totalItems: filtered.length, totalPages: Math.ceil(filtered.length / perPage), page, perPage };
  },
} as DataStore;

assert.equal((await listAllRecords({ store: memoryStore, collection: 'rows', query: { where: { tenant: 't1' } } })).length, 501);
await assert.rejects(
  listAllRecords({ store: memoryStore, collection: 'rows', maxRecords: 500 }),
  RecordScanLimitError,
);
assert.equal(nextFairPage(1, 3), 2);
assert.equal(nextFairPage(3, 3), 1);
console.log('complete pagination, visible scan cap, and fair page rotation tests passed');
