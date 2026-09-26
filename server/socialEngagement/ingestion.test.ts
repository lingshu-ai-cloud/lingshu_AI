import assert from 'node:assert/strict';
import { store } from '../storage/index.js';
import { ingestEngagementEvents, type EngagementIngestionAdapter } from './ingestion.js';

type Row = { id: string; [key: string]: unknown };
const rows: Row[] = [];
const original = { list: store.list, create: store.create };
(store as any).list = async (_collection: string, query: any) => ({ items: rows.filter(row => Object.entries(query.where || {}).every(([key, value]) => row[key] === value)), totalItems: rows.length, totalPages: 1, page: 1, perPage: 500 });
(store as any).create = async (_collection: string, data: Omit<Row, 'id'>) => { const row = { id: `interaction-${rows.length + 1}`, ...data }; rows.push(row); return row; };

try {
  const adapter: EngagementIngestionAdapter = {
    capability: { platform: 'web_form', surface: 'forms', status: 'available' },
    async pull() { return { cursor: 'cursor-2', events: [{ kind: 'form', platform: 'web_form', providerEventId: 'form-1', body: 'Need a quote', occurredAt: '2026-09-26T00:00:00Z' }] }; },
  };
  const first = await ingestEngagementEvents({ tenantId: 'tenant-a', adapter });
  assert.equal(first.items[0]?.source_confidence, 'unknown');
  assert.equal(first.items[0]?.qualification_status, 'candidate', 'ingestion cannot self-qualify a lead');
  assert.equal(first.cursor, 'cursor-2');
  assert.equal((await ingestEngagementEvents({ tenantId: 'tenant-a', adapter })).repeated, 1, 'provider replay is idempotent');
  const unavailable = await ingestEngagementEvents({ tenantId: 'tenant-a', adapter: { capability: { platform: 'tiktok', surface: 'direct_messages', status: 'unavailable', reason: 'not connected' }, async pull() { throw Error('must not pull'); } } });
  assert.equal(unavailable.items.length, 0);
} finally {
  Object.assign(store, original);
}
console.log('engagement ingestion adapter tests passed');
