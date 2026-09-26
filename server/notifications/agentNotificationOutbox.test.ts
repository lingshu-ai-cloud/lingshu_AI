import assert from 'node:assert/strict';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { consumeAgentNotificationDomainEvent } from './agentNotifications.js';
import { consumeAgentNotificationOutboxBatch, enqueueAgentNotificationDomainEvent } from './agentNotificationOutbox.js';

function memoryStore(): DataStore & { rows: Map<string, Array<Record<string, any>>> } {
  const rows = new Map<string, Array<Record<string, any>>>();
  let sequence = 0;
  const collection = (name: string) => rows.get(name) ?? (rows.set(name, []), rows.get(name)!);
  return {
    rows,
    async getById<T>(name: string, id: string) { return (collection(name).find(item => item.id === id) as T) ?? null; },
    async create<T>(name: string, data: Record<string, unknown>) {
      const items = collection(name);
      if (name === 'agent_notification_outbox' && items.some(item => item.tenant_id === data.tenant_id && item.event_id === data.event_id)) return null;
      if (name === 'agent_notifications' && items.some(item => item.tenant_id === data.tenant_id && item.event_key === data.event_key)) return null;
      const item = { id: `row-${++sequence}`, ...structuredClone(data) };
      items.push(item);
      return structuredClone(item) as T;
    },
    async update(name: string, id: string, data: Record<string, unknown>) {
      const item = collection(name).find(row => row.id === id);
      if (!item) return false;
      Object.assign(item, structuredClone(data));
      return true;
    },
    async delete(name: string, id: string) {
      const items = collection(name); const index = items.findIndex(item => item.id === id);
      if (index < 0) return false; items.splice(index, 1); return true;
    },
    async list<T>(name: string, query: ListQuery = {}) {
      let items = collection(name).filter(item => Object.entries(query.where ?? {}).every(([key, value]) => item[key] === value));
      if (query.sort) {
        const descending = query.sort.startsWith('-'); const key = descending ? query.sort.slice(1) : query.sort;
        items = [...items].sort((left, right) => String(left[key] ?? '').localeCompare(String(right[key] ?? '')) * (descending ? -1 : 1));
      }
      const page = query.page ?? 1; const perPage = query.perPage ?? 30; const start = (page - 1) * perPage;
      return { items: structuredClone(items.slice(start, start + perPage)) as T[], totalItems: items.length, totalPages: Math.max(1, Math.ceil(items.length / perPage)), page, perPage };
    },
  };
}

const dataStore = memoryStore();
const event = {
  eventId: 'scope-change-1', kind: 'scope.changed' as const, tenantId: 'tenant-a', programId: 'program-a',
  entityId: 'scope-a', title: '发现范围已更新', summary: '账号与关键词范围发生变化。', sourceAgent: 'discovery_agent',
  changes: [{ field: 'keywords', label: '关键词', before: ['old'], after: ['new'] }], occurredAt: '2026-09-28T00:00:00.000Z',
};

assert.equal((await enqueueAgentNotificationDomainEvent(event, dataStore)).created, true);
assert.equal((await enqueueAgentNotificationDomainEvent(event, dataStore)).created, false, 'producer replay returns the same outbox event');
await assert.rejects(enqueueAgentNotificationDomainEvent({ ...event, summary: 'conflicting payload' }, dataStore), /notification_outbox_event_conflict/);

let crashed = false;
const first = await consumeAgentNotificationOutboxBatch({
  dataStore, now: new Date('2026-09-28T00:00:01.000Z'),
  consume: async (item, store) => {
    const result = await consumeAgentNotificationDomainEvent(item, store);
    crashed = true;
    throw Object.assign(new Error('simulated_ack_crash'), { notification: result.notification });
  },
});
assert.equal(crashed, true);
assert.equal(first.failed, 1);
assert.equal(dataStore.rows.get('agent_notifications')?.length, 1, 'notification is durable before the simulated crash');

const retried = await consumeAgentNotificationOutboxBatch({ dataStore, now: new Date('2026-09-28T00:00:10.000Z') });
assert.equal(retried.delivered, 1);
assert.equal(dataStore.rows.get('agent_notifications')?.length, 1, 'at-least-once delivery deduplicates at the notification event key');
assert.equal(dataStore.rows.get('agent_notification_outbox')?.[0]?.status, 'delivered');

console.log('agent notification outbox tests passed');
