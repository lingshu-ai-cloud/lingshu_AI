import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../storage/index.js';
import { readAdRows } from './readPages.js';
test('analysis exhausts ad pages without changing ordinary workspace list size; scope corruption fails closed', async () => {
  const original = store.list;
  const rows = Array.from({ length: 501 }, (_, i) => ({ id: `ad-${i}`, tenant_id: 't', taskId: 'task' }));
  try {
    store.list = async <T>(_collection: string, query?: import('../storage/datastore.js').ListQuery) => {
      const page = query?.page || 1;
      return { items: rows.slice((page - 1) * 200, page * 200) as T[], totalItems: rows.length, totalPages: 3, page, perPage: 200 };
    };
    assert.equal((await readAdRows('test', 't', 'task', false)).length, 200);
    assert.equal((await readAdRows('test', 't', 'task', true)).length, 501);
    rows[400].tenant_id = 'other';
    await assert.rejects(readAdRows('test', 't', 'task', true), /scope_invalid/);
  } finally { store.list = original; }
});
