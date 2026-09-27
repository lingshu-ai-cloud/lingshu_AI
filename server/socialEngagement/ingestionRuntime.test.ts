import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { ingestEngagementEvents, type EngagementIngestionAdapter } from './ingestion.js';
import { createWebFormSource, ingestSignedWebForm } from './webForm.js';

type Row = { id: string; [key: string]: any };
function memoryStore(): DataStore & { rows: Map<string, Row[]> } {
  const rows = new Map<string, Row[]>();
  return {
    rows,
    async list<T>(collection: string, query: ListQuery = {}) { let items = [...(rows.get(collection) || [])]; for (const [key, value] of Object.entries(query.where || {})) items = items.filter(item => item[key] === value); const totalItems = items.length; const perPage = query.perPage ?? 500; return { items: items.slice(0, perPage) as T[], totalItems, totalPages: Math.ceil(totalItems / perPage), page: 1, perPage }; },
    async getById<T>(collection: string, id: string) { return ((rows.get(collection) || []).find(item => item.id === id) as T | undefined) ?? null; },
    async create<T>(collection: string, data: Record<string, unknown>) { const item = { id: `${collection}-${(rows.get(collection)?.length || 0) + 1}`, ...data }; rows.set(collection, [...(rows.get(collection) || []), item]); return item as T; },
    async update(collection: string, id: string, data: Record<string, unknown>) { const item = (rows.get(collection) || []).find(row => row.id === id); if (!item) return false; Object.assign(item, data); return true; },
    async delete() { return false; },
  };
}

const dataStore = memoryStore();
let pulls = 0;
const adapter: EngagementIngestionAdapter = {
  adapterId: 'mock-comments:account-1',
  capability: { platform: 'youtube', surface: 'comments', status: 'available', accountId: 'account-1', verifiedAt: '2026-09-25T00:00:00Z' },
  async pull(cursor) {
    pulls += 1;
    if (pulls < 3) throw new Error('temporary_provider_failure');
    assert.equal(cursor, undefined);
    return { cursor: '2026-09-26T00:00:00Z|comment-1', events: [{ kind: 'comment', platform: 'youtube', providerEventId: 'comment-1', accountId: 'account-1', contentId: 'video-1', body: 'Price?', occurredAt: '2026-09-26T00:00:00Z' }] };
  },
};
const ingested = await ingestEngagementEvents({ tenantId: 'tenant-a', accountId: 'account-1', adapter, dataStore, maxRetries: 3, wait: async () => undefined, verifyAccountOwnership: async (tenant, account) => tenant === 'tenant-a' && account === 'account-1', now: new Date('2026-09-26T01:00:00Z') });
assert.equal(ingested.items.length, 1);
assert.equal(pulls, 3, 'temporary provider failures use bounded retry');
assert.equal(dataStore.rows.get('social_engagement_cursors')?.[0]?.cursor, '2026-09-26T00:00:00Z|comment-1');
await assert.rejects(ingestEngagementEvents({ tenantId: 'tenant-b', accountId: 'account-1', adapter, dataStore, verifyAccountOwnership: async () => false }), /engagement_account_tenant_mismatch/);

const source = await createWebFormSource({ tenantId: 'tenant-a', userId: 'operator-1', accountId: 'form-account-1', label: 'RFQ form', sourceId: 'form_source_1', dataStore, now: new Date('2026-09-26T02:00:00Z') });
const body = { eventId: 'form-event-1', message: 'Need a quote for 1000 units', occurredAt: '2026-09-26T02:01:00Z', accountId: 'attacker-account' };
const rawBody = Buffer.from(JSON.stringify(body));
const signature = `sha256=${createHmac('sha256', source.signingSecret).update(rawBody).digest('hex')}`;
const first = await ingestSignedWebForm({ sourceId: source.source.source_id, rawBody, signature, body, dataStore, now: new Date('2026-09-26T02:01:30Z') });
assert.equal(first.item.tenant_id, 'tenant-a');
assert.equal(first.item.accountId, 'form-account-1', 'payload cannot choose another account or tenant');
assert.equal((await ingestSignedWebForm({ sourceId: source.source.source_id, rawBody, signature, body, dataStore, now: new Date('2026-09-26T02:01:31Z') })).repeated, true);
await assert.rejects(ingestSignedWebForm({ sourceId: source.source.source_id, rawBody, signature: 'sha256=' + '0'.repeat(64), body, dataStore }), /web_form_signature_invalid/);

console.log('engagement cursor, retry, tenancy, signature and idempotency tests passed');
