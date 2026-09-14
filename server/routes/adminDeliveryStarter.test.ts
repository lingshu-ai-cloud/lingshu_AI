import assert from 'node:assert/strict';
import express from 'express';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';
import { createStarter198Repository, STARTER_COLLECTIONS } from '../starter198/repository.js';
import { createAdminDeliveryStarterRouter, deliveryTenantIdForRequest } from './adminDeliveryStarter.js';

const rows = new Map<string, Map<string, Record_>>();
const collection = (name: string): Map<string, Record_> => {
  let current = rows.get(name);
  if (!current) { current = new Map(); rows.set(name, current); }
  return current;
};
const dataStore: DataStore = {
  async getById<T = Record_>(name: string, id: string) {
    const value = collection(name).get(id);
    return value ? structuredClone(value) as T : null;
  },
  async create<T = Record_>(name: string, data: Record<string, unknown>) {
    const target = collection(name);
    const id = String(data.id || `${name}-${target.size + 1}`);
    if (target.has(id)) throw new Error('duplicate record id');
    if (name === 'durable_operation_leases' && [...target.values()].some(row => (
      row.tenant_id === data.tenant_id
      && row.lease_scope === data.lease_scope
      && row.subject_id === data.subject_id
    ))) throw new Error('duplicate lease subject');
    const value = { ...structuredClone(data), id } as Record_;
    target.set(id, value);
    return structuredClone(value) as T;
  },
  async update(name: string, id: string, patch: Record<string, unknown>) {
    const current = collection(name).get(id);
    if (!current) return false;
    collection(name).set(id, { ...current, ...structuredClone(patch) });
    return true;
  },
  async delete(name: string, id: string) { return collection(name).delete(id); },
  async list<T = Record_>(name: string, query: ListQuery = {}) {
    const items = [...collection(name).values()].filter(row => Object.entries(query.where ?? {})
      .every(([key, value]) => String(row[key] ?? '') === String(value)));
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    return {
      items: structuredClone(items.slice((page - 1) * perPage, page * perPage)) as T[],
      totalItems: items.length,
      totalPages: Math.ceil(items.length / perPage),
      page,
      perPage,
    };
  },
};
const repository = createStarter198Repository(dataStore);
const router = createAdminDeliveryStarterRouter({
  authenticateAdmin: async () => ({ userId: 'admin-user', tenantId: 'admin-tenant', email: 'admin@example.test' }),
  dataStore,
  repository,
  presentTenant: (_req, tenant) => tenant,
});
const app = express();
app.use(express.json());
app.use('/admin', router);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('test server did not bind a TCP port');
const origin = `http://127.0.0.1:${address.port}`;
const requestId = '4de13b4b-e4ca-4e82-9e2a-23d15760a9c0';
const requestBody = {
  requestId,
  companyName: 'Response Loss Company',
  contactName: 'Owner',
  industry: 'Export',
  notes: 'Retry must recover the original tenant',
};

async function createTenant(includeRequestId = true) {
  return fetch(`${origin}/admin/delivery/tenants`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(includeRequestId ? { 'Idempotency-Key': requestId } : {}),
    },
    body: JSON.stringify(includeRequestId ? requestBody : { companyName: requestBody.companyName }),
  });
}

try {
  const missingId = await createTenant(false);
  assert.equal(missingId.status, 400);
  assert.equal((await missingId.json() as Record<string, unknown>).error, 'delivery_request_id_required');

  const firstResponse = await createTenant();
  assert.equal(firstResponse.status, 200);
  const firstBody = await firstResponse.json() as { tenant: Record<string, unknown> };
  // Model a client losing the first response: retry the unchanged request with
  // the persisted UUID, without using any data from firstBody to form the call.
  const retryResponse = await createTenant();
  assert.equal(retryResponse.status, 200);
  const retryBody = await retryResponse.json() as { tenant: Record<string, unknown> };

  const tenantId = deliveryTenantIdForRequest('admin-tenant', requestId);
  assert.equal(firstBody.tenant.id, tenantId);
  assert.equal(retryBody.tenant.id, tenantId);
  assert.equal(retryBody.tenant.inviteCode, firstBody.tenant.inviteCode,
    'a response-loss retry must recover the already-published invitation');
  assert.equal(collection('tenants').size, 1, 'a response-loss retry must create exactly one tenant');
  assert.equal(collection(STARTER_COLLECTIONS.access).size, 1,
    'a response-loss retry must create exactly one Starter entitlement');

  console.log('admin delivery Starter request idempotency tests passed');
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
