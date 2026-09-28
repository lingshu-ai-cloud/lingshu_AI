import assert from 'node:assert/strict';
import { managedPublishingCapacity, withManagedPublishingCycleLease } from './managedPublishingCycleLease.js';
import type { DataStore } from '../storage/datastore.js';
const item = { sourceProjectId: 'social-task', accountIds: ['account'], sourceClaim: { artifactId: 'artifact' } };
const binding = { payload: { socialTaskId: 'social-task', artifactId: 'artifact', accountId: 'account' } };
const post = { id: 'post', stats: { sourceProjectId: 'social-task', targetAccountIds: ['account'], publishSourceClaim: { artifactId: 'artifact' } } };
assert.deepEqual(managedPublishingCapacity({ maxPublishItems: 1, posts: [], bindings: [binding], additions: [item] }), { used: 1, allowed: true }, 'consuming a reservation is not a second charge');
assert.deepEqual(managedPublishingCapacity({ maxPublishItems: 1, posts: [post], bindings: [binding], additions: [] }), { used: 1, allowed: true }, 'completed reservation and post count once');
assert.equal(managedPublishingCapacity({ maxPublishItems: 1, posts: [post], bindings: [], additions: [item] }).allowed, false);
assert.equal(managedPublishingCapacity({ maxPublishItems: 1, posts: [], bindings: [binding], additions: [{ ...item, sourceProjectId: 'other' }] }).allowed, false);
assert.equal(managedPublishingCapacity({ maxPublishItems: 0, posts: [], bindings: [], additions: [] }).allowed, false);
const rows: any[] = [];
let creates = 0;
const data = {
  async list(_collection: string, query: any) { const items = rows.filter(row => Object.entries(query?.where || {}).every(([key, value]) => row[key] === value)); return { items, totalItems: items.length, totalPages: 1, page: 1, perPage: 100 }; },
  async create(_collection: string, value: any) { creates++; const row = { id: `row-${creates}`, ...value }; rows.push(row); return row; },
  async getById(_collection: string, id: string) { return rows.find(row => row.id === id) || null; },
  async update(_collection: string, id: string, value: any) { const row = rows.find(row => row.id === id); if (!row) return false; Object.assign(row, value); return true; },
  async delete(_collection: string, id: string) { const index = rows.findIndex(row => row.id === id); if (index >= 0) rows.splice(index, 1); return index >= 0; },
} as DataStore;
const input = { tenantId: 'tenant', runId: 'run', dataStore: data, now: new Date() };
await withManagedPublishingCycleLease(input, async lease => {
  await withManagedPublishingCycleLease(input, async nested => { assert.equal(nested, lease); });
  await assert.rejects(withManagedPublishingCycleLease({ ...input, dataStore: { ...data } }, async () => undefined), /storage_authority_mismatch/);
});
assert.equal(creates, 1, 'reentrant bridge/calendar consumes one durable lease');
console.log('managed publishing cycle lease and shared quota tests passed');
