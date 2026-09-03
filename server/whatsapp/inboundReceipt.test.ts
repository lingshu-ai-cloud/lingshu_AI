import assert from 'node:assert/strict';
import type { AtomicCompareResult, DataStore, ListQuery, ListResult, Record_, Where } from '../storage/datastore.js';
import { inboundReceiptHealthCheck, processInboundExactlyOnce, type InboundReceipt } from './inboundReceipt.js';

class MemoryStore implements DataStore {
  private records = new Map<string, Record_>();
  private serial = Promise.resolve();

  async getById<T = Record_>(_collection: string, id: string): Promise<T | null> {
    return (this.records.get(id) as T | undefined) ?? null;
  }
  async create<T = Record_>(_collection: string, data: Record<string, unknown>): Promise<T> {
    const record = { id: `r${this.records.size + 1}`, ...data } as T & Record_;
    this.records.set(record.id, record);
    return record;
  }
  async update(_collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
    const current = this.records.get(id);
    if (!current) return false;
    this.records.set(id, { ...current, ...data });
    return true;
  }
  async delete(_collection: string, id: string): Promise<boolean> { return this.records.delete(id); }
  async list<T = Record_>(_collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    const filtered = [...this.records.values()].filter(record => Object.entries(query.where ?? {})
      .every(([key, value]) => String(record[key] ?? '') === String(value)));
    return { items: filtered as T[], totalItems: filtered.length, totalPages: filtered.length ? 1 : 0, page: 1, perPage: query.perPage ?? 20 };
  }
  async compareAndSet<T = Record_>(
    _collection: string,
    id: string,
    expected: Where,
    data: Record<string, unknown>,
  ): Promise<AtomicCompareResult<T>> {
    const current = this.records.get(id);
    if (!current) return { ok: false as const, reason: 'not_found' as const };
    if (!Object.entries(expected).every(([key, value]) => String(current[key] ?? '') === String(value))) {
      return { ok: false, reason: 'conflict', current: current as T };
    }
    const next = { ...current, ...data } as T & Record_;
    this.records.set(id, next);
    return { ok: true, record: next as T };
  }
  async createIfAbsent<T = Record_>(_collection: string, uniqueWhere: Where, data: Record<string, unknown>) {
    let release: (() => void) | undefined;
    const previous = this.serial;
    this.serial = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      const existing = [...this.records.values()].find(record => Object.entries(uniqueWhere)
        .every(([key, value]) => String(record[key] ?? '') === String(value)));
      if (existing) return { created: false, record: existing as T };
      const record = { id: `r${this.records.size + 1}`, ...data, ...uniqueWhere } as T & Record_;
      this.records.set(record.id, record);
      return { created: true, record: record as T };
    } finally {
      release?.();
    }
  }
  values(): InboundReceipt[] { return [...this.records.values()] as InboundReceipt[]; }
}

const store = new MemoryStore();
let executions = 0;
let unblock!: () => void;
const gate = new Promise<void>(resolve => { unblock = resolve; });
const first = processInboundExactlyOnce({
  store,
  tenantId: 'tenant-a',
  provider: 'meta_whatsapp',
  messageId: 'wamid.1',
  work: async () => { executions += 1; await gate; },
});
await new Promise(resolve => setImmediate(resolve));
const duplicateWhileRunning = await processInboundExactlyOnce({
  store,
  tenantId: 'tenant-a',
  provider: 'meta_whatsapp',
  messageId: 'wamid.1',
  work: async () => { executions += 1; },
});
assert.equal(duplicateWhileRunning.outcome, 'in_progress');
unblock();
assert.equal((await first).outcome, 'processed');
assert.equal(executions, 1);
assert.equal((await processInboundExactlyOnce({
  store,
  tenantId: 'tenant-a',
  provider: 'meta_whatsapp',
  messageId: 'wamid.1',
  work: async () => { executions += 1; },
})).outcome, 'duplicate');
assert.equal(executions, 1);

await assert.rejects(() => processInboundExactlyOnce({
  store,
  tenantId: 'tenant-a',
  provider: 'meta_whatsapp',
  messageId: 'wamid.failure',
  work: async () => { throw new TypeError('sensitive provider detail'); },
}), /sensitive provider detail/);
const failed = store.values().find(item => item.message_id === 'wamid.failure');
assert.equal(failed?.status, 'needs_reconciliation');
assert.equal(failed?.last_error_code, 'typeerror');
assert.equal(JSON.stringify(failed).includes('sensitive provider detail'), false);
assert.equal((await processInboundExactlyOnce({
  store,
  tenantId: 'tenant-a',
  provider: 'meta_whatsapp',
  messageId: 'wamid.failure',
  work: async () => { executions += 1; },
})).outcome, 'needs_reconciliation');
assert.equal(executions, 1);
assert.equal((await inboundReceiptHealthCheck({ store })).message, 'whatsapp_inbound_reconciliation_required');

const staleStore = new MemoryStore();
await staleStore.create<InboundReceipt>('webhook_message_receipts', {
  tenant_id: 'tenant-a', provider: 'meta_whatsapp', message_id: 'wamid.stale', status: 'processing',
  revision: 0, received_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  claim_expires_at: '2026-01-01T00:01:00.000Z',
});
const stale = await processInboundExactlyOnce({
  store: staleStore,
  tenantId: 'tenant-a',
  provider: 'meta_whatsapp',
  messageId: 'wamid.stale',
  now: () => new Date('2026-01-01T00:02:00.000Z'),
  work: async () => { throw new Error('must_not_run'); },
});
assert.equal(stale.outcome, 'needs_reconciliation');
assert.equal(staleStore.values()[0]?.last_error_code, 'processing_lease_expired');

console.log('WhatsApp inbound receipt fencing prevents duplicate and unknown-outcome replay');
