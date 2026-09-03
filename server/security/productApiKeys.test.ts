import assert from 'node:assert/strict';
import type { AtomicCompareResult, DataStore, ListQuery, ListResult, Record_, Where } from '../storage/datastore.js';
import {
  ensureProductApiKey,
  generateProductApiSecret,
  hashProductApiSecret,
  productApiKeyStatus,
  productApiSecretMatchesHash,
  rotateProductApiKey,
  verifyProductApiKey,
  type ProductApiKeyRecord,
} from './productApiKeys.js';

class MemoryAtomicStore implements DataStore {
  private records = new Map<string, Record_[]>();
  readonly queries: Array<{ collection: string; where?: Where }> = [];
  private nextId = 1;

  private collection(name: string): Record_[] {
    const records = this.records.get(name) || [];
    this.records.set(name, records);
    return records;
  }

  async getById<T = Record_>(collection: string, id: string): Promise<T | null> {
    return (this.collection(collection).find(record => record.id === id) as T | undefined) || null;
  }

  async create<T = Record_>(collection: string, data: Record<string, unknown>): Promise<T> {
    const record = { id: `record-${this.nextId++}`, ...data } as Record_;
    this.collection(collection).push(record);
    return record as T;
  }

  async update(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
    const records = this.collection(collection);
    const index = records.findIndex(record => record.id === id);
    if (index < 0) return false;
    records[index] = { ...records[index], ...data };
    return true;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const records = this.collection(collection);
    const index = records.findIndex(record => record.id === id);
    if (index < 0) return false;
    records.splice(index, 1);
    return true;
  }

  async list<T = Record_>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    this.queries.push({ collection, where: query.where });
    const filtered = this.collection(collection).filter(record => Object.entries(query.where || {})
      .every(([key, expected]) => String(record[key] ?? '') === String(expected)));
    const perPage = query.perPage || 20;
    return {
      items: filtered.slice(0, perPage) as T[],
      totalItems: filtered.length,
      totalPages: Math.ceil(filtered.length / perPage),
      page: 1,
      perPage,
    };
  }

  async compareAndSet<T = Record_>(collection: string, id: string, expected: Where, data: Record<string, unknown>): Promise<AtomicCompareResult<T>> {
    const records = this.collection(collection);
    const index = records.findIndex(record => record.id === id);
    if (index < 0) return { ok: false, reason: 'not_found' };
    const current = records[index];
    if (!Object.entries(expected).every(([key, wanted]) => String(current[key] ?? '') === String(wanted))) {
      return { ok: false, reason: 'conflict', current: current as T };
    }
    const next = { ...current, ...data } as Record_;
    records[index] = next;
    return { ok: true, record: next as T };
  }

  async createIfAbsent<T = Record_>(collection: string, uniqueWhere: Where, data: Record<string, unknown>): Promise<{ created: boolean; record: T }> {
    const records = this.collection(collection);
    const existing = records.find(record => Object.entries(uniqueWhere)
      .every(([key, wanted]) => String(record[key] ?? '') === String(wanted)));
    if (existing) return { created: false, record: existing as T };
    const record = await this.create<T>(collection, { ...data, ...uniqueWhere });
    return { created: true, record };
  }
}

const store = new MemoryAtomicStore();
const createdAt = '2026-09-02T01:00:00.000Z';
const concurrentCreate = await Promise.all([
  ensureProductApiKey(store, 'tenant-a', createdAt),
  ensureProductApiKey(store, 'tenant-a', createdAt),
]);
assert.equal(concurrentCreate.filter(result => Boolean(result.secret)).length, 1, 'only the atomic creator may receive the one-time secret');
const tenantASecret = concurrentCreate.find(result => result.secret)?.secret || '';
assert.match(tenantASecret, /^ls_prod_[A-Za-z0-9_-]{32}$/);
const tenantARecords = (await store.list<ProductApiKeyRecord>('tenant_api_keys', { where: { tenant_id: 'tenant-a' } })).items;
assert.equal(tenantARecords.length, 1, 'tenant key uniqueness must survive concurrent creation');
assert.equal(Object.prototype.hasOwnProperty.call(tenantARecords[0], 'api_key'), false, 'new records must not contain a plaintext field');
assert.equal(JSON.stringify(tenantARecords[0]).includes(tenantASecret), false, 'raw secret must never be persisted');
assert.equal(tenantARecords[0].api_key_hash, hashProductApiSecret(tenantASecret));
assert.equal(productApiSecretMatchesHash(tenantASecret, String(tenantARecords[0].api_key_hash)), true);
const wrongTenantASecret = `${tenantASecret.slice(0, -1)}${tenantASecret.endsWith('A') ? 'B' : 'A'}`;
assert.equal(productApiSecretMatchesHash(wrongTenantASecret, String(tenantARecords[0].api_key_hash)), false);

const secondRead = await ensureProductApiKey(store, 'tenant-a', '2026-09-02T01:01:00.000Z');
assert.equal(secondRead.secret, undefined, 'an existing credential must never be re-exposed');
assert.equal(JSON.stringify(secondRead.metadata).includes(tenantASecret), false);
assert.deepEqual(await verifyProductApiKey(store, tenantASecret), {
  recordId: tenantARecords[0].id,
  tenantId: 'tenant-a',
  keyHash: hashProductApiSecret(tenantASecret),
  version: 1,
});
assert.equal(await verifyProductApiKey(store, 'ls_prod_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), null);

const tenantB = await ensureProductApiKey(store, 'tenant-b', '2026-09-02T01:02:00.000Z');
assert.ok(tenantB.secret);
assert.equal((await verifyProductApiKey(store, tenantB.secret!))?.tenantId, 'tenant-b');
assert.equal((await verifyProductApiKey(store, tenantASecret))?.tenantId, 'tenant-a', 'a valid key must resolve only its owning tenant');

const concurrentRotations = await Promise.allSettled([
  rotateProductApiKey(store, 'tenant-a', '2026-09-02T02:00:00.000Z'),
  rotateProductApiKey(store, 'tenant-a', '2026-09-02T02:00:00.000Z'),
]);
assert.equal(concurrentRotations.filter(result => result.status === 'fulfilled').length, 1, 'concurrent rotations must use CAS');
assert.equal(concurrentRotations.filter(result => result.status === 'rejected').length, 1);
const rotatedSecret = (concurrentRotations.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof rotateProductApiKey>>>).value.secret!;
assert.equal(await verifyProductApiKey(store, tenantASecret), null, 'rotation must immediately invalidate the old digest');
assert.equal((await verifyProductApiKey(store, rotatedSecret))?.tenantId, 'tenant-a');

const legacySecret = generateProductApiSecret();
const legacy = await store.create<ProductApiKeyRecord>('tenant_api_keys', {
  tenant_id: 'tenant-legacy',
  api_key: legacySecret,
  created_at: '2025-01-01T00:00:00.000Z',
});
assert.equal(await verifyProductApiKey(store, legacySecret), null, 'legacy plaintext credentials are revoked and never accepted');
const legacyStatus = await productApiKeyStatus(store, 'tenant-legacy');
assert.equal(legacyStatus.configured, false);
assert.equal(legacyStatus.rotationRequired, true);
assert.equal(JSON.stringify(legacyStatus).includes(legacySecret), false, 'legacy plaintext must never appear in status metadata');
const migrated = await rotateProductApiKey(store, 'tenant-legacy', '2026-09-02T03:00:00.000Z');
assert.ok(migrated.secret);
assert.equal((await store.getById<ProductApiKeyRecord>('tenant_api_keys', legacy.id))?.api_key, '', 'rotation must scrub a legacy plaintext column when present');
assert.equal((await verifyProductApiKey(store, migrated.secret!))?.tenantId, 'tenant-legacy');

const revokedRecord = (await store.list<ProductApiKeyRecord>('tenant_api_keys', { where: { tenant_id: 'tenant-b' } })).items[0];
await store.update('tenant_api_keys', revokedRecord.id, { revoked_at: '2026-09-02T04:00:00.000Z' });
assert.equal(await verifyProductApiKey(store, tenantB.secret!), null, 'revoked digests must not authenticate');

assert.ok(store.queries.every(query => !query.where || !Object.prototype.hasOwnProperty.call(query.where, 'api_key')),
  'verification must never query the datastore by raw api_key');

console.log('hashed one-time product API key, rotation, revocation, concurrency, and tenant isolation tests passed');
