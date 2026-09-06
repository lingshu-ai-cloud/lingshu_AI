import assert from 'node:assert/strict';
import { store } from '../storage/index.js';
import { listRunEventsAfter } from './runEventReplay.js';

const original = store.list;
const rows = Array.from({ length: 1205 }, (_, index) => ({ id: `event-${1205 - index}`, sequence: 1205 - index }));
try {
  store.list = async (_collection, query) => {
    assert.deepEqual(query?.where, { tenant_id: 'tenant-a', run_id: 'run-a' });
    const page = query?.page || 1;
    return { items: rows.slice((page - 1) * 500, page * 500) as any, page, perPage: 500, totalItems: rows.length, totalPages: 3 };
  };
  const recent = await listRunEventsAfter('tenant-a', 'run-a', 1199);
  assert.deepEqual(recent.map(item => item.sequence), [1200, 1201, 1202, 1203, 1204, 1205]);
  const replay = await listRunEventsAfter('tenant-a', 'run-a', 200);
  assert.equal(replay.length, 1005);
  assert.equal(replay[0].sequence, 201);
  assert.equal(replay.at(-1)?.sequence, 1205);
  console.log('Long-running event replay tests passed');
} finally { store.list = original; }
