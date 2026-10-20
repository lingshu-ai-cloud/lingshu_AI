import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { test } from 'node:test';
import type { CompareExpected, DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import {
  CUSTOMER_POINTS_EVENTS,
  CUSTOMER_POINTS_WALLETS,
  CustomerPointsError,
  createCustomerPointsLedger,
} from './customerPointsLedger.js';

type Row = Record_ & Record<string, unknown>;

class MemoryStore implements DataStore {
  readonly rows = new Map<string, Row[]>([
    [CUSTOMER_POINTS_WALLETS, []],
    [CUSTOMER_POINTS_EVENTS, []],
  ]);
  private sequence = 0;

  supportsAtomicCompareAndSwap() { return true; }

  async getById<T = Record_>(collection: string, id: string): Promise<T | null> {
    return structuredClone(this.rows.get(collection)?.find(row => row.id === id) as T | undefined) ?? null;
  }

  async create<T = Record_>(collection: string, data: Record<string, unknown>): Promise<T | null> {
    const bucket = this.rows.get(collection) ?? [];
    const duplicate = collection === CUSTOMER_POINTS_WALLETS
      ? bucket.some(row => row.tenant_id === data.tenant_id)
      : collection === CUSTOMER_POINTS_EVENTS
        ? bucket.some(row => row.tenant_id === data.tenant_id && row.event_id === data.event_id)
        : false;
    if (duplicate) return null;
    this.sequence += 1;
    const row = { id: `row-${this.sequence}`, ...structuredClone(data) } as Row;
    bucket.push(row);
    this.rows.set(collection, bucket);
    return structuredClone(row) as T;
  }

  async update(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
    const row = this.rows.get(collection)?.find(item => item.id === id);
    if (!row) return false;
    Object.assign(row, structuredClone(data));
    return true;
  }

  async compareAndSwap(collection: string, id: string, expected: CompareExpected, data: Record<string, unknown>): Promise<boolean> {
    const row = this.rows.get(collection)?.find(item => item.id === id);
    if (!row || Object.entries(expected).some(([key, value]) => !isDeepStrictEqual(row[key], value))) return false;
    Object.assign(row, structuredClone(data));
    return true;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const bucket = this.rows.get(collection) ?? [];
    const index = bucket.findIndex(row => row.id === id);
    if (index < 0) return false;
    bucket.splice(index, 1);
    return true;
  }

  async list<T = Record_>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    const items = (this.rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {})
      .every(([key, value]) => row[key] === value));
    return {
      items: structuredClone(items) as T[], totalItems: items.length, totalPages: items.length ? 1 : 0,
      page: query.page ?? 1, perPage: query.perPage ?? 20,
    };
  }
}

const now = new Date('2026-10-20T08:00:00.000Z');
const allocations = {
  business_operations: 20,
  insight_planning: 40,
  content_production: 100,
  traffic_growth: 20,
  customer_service: 20,
  knowledge_assistant: 20,
} as const;

async function fixture(custom: Record<keyof typeof allocations, number> = allocations) {
  const store = new MemoryStore();
  const ledger = createCustomerPointsLedger(store, () => new Date(now));
  await ledger.provisionPlan({
    tenantId: 'tenant-a', planId: 'professional-monthly', planLabel: '专业版',
    cycleStartsAt: '2026-10-01T00:00:00.000Z', cycleEndsAt: '2026-11-01T00:00:00.000Z',
    allocations: custom, idempotencyKey: 'plan-2026-10',
  });
  return { store, ledger };
}

test('plan and add-on balances are separate, plan points are spent first, and settlement returns unused reservation', async () => {
  const { ledger } = await fixture();
  await ledger.grantAddon({ tenantId: 'tenant-a', points: 200, purchaseId: 'purchase-a', idempotencyKey: 'purchase-a' });

  const script = await ledger.reserve({
    tenantId: 'tenant-a', operationId: 'script-a', idempotencyKey: 'script-a',
    featureRateId: 'script-storyboard-generation', quantity: 4,
  });
  assert.deepEqual(script.allocation, { planPoints: 60, addonPoints: 0 });
  assert.equal((await ledger.reserve({ tenantId: 'tenant-a', operationId: 'script-a', idempotencyKey: 'script-a', featureRateId: 'script-storyboard-generation', quantity: 4 })).id, script.id);
  await ledger.settle({ tenantId: 'tenant-a', idempotencyKey: 'script-a', actualQuantity: 4 });

  const generated = await ledger.reserve({
    tenantId: 'tenant-a', operationId: 'aigc-a', idempotencyKey: 'aigc-a',
    featureRateId: 'aigc-video-generation', quantity: 1,
  });
  assert.deepEqual(generated.allocation, { planPoints: 40, addonPoints: 40 });
  const settled = await ledger.settle({ tenantId: 'tenant-a', idempotencyKey: 'aigc-a', actualQuantity: 0.5 });
  assert.equal(settled.settledPoints, 40);
  assert.equal(settled.releasedPoints, 40);

  const summary = await ledger.summary('tenant-a');
  assert.equal(summary.plan?.usedPoints, 100);
  assert.equal(summary.addon.usedPoints, 0);
  assert.equal(summary.addon.remainingPoints, 200);
});

test('failed work releases both plan and add-on reservations and system retry remains idempotent', async () => {
  const { ledger } = await fixture({ ...allocations, content_production: 30 });
  await ledger.grantAddon({ tenantId: 'tenant-a', points: 100, purchaseId: 'purchase-a', idempotencyKey: 'purchase-a' });
  const reserved = await ledger.reserve({
    tenantId: 'tenant-a', operationId: 'aigc-b', idempotencyKey: 'aigc-b',
    featureRateId: 'aigc-video-generation', quantity: 1,
  });
  assert.deepEqual(reserved.allocation, { planPoints: 30, addonPoints: 50 });
  const released = await ledger.release({ tenantId: 'tenant-a', idempotencyKey: 'aigc-b', reason: 'provider_failed' });
  assert.equal(released.releasedPoints, 80);
  assert.equal((await ledger.release({ tenantId: 'tenant-a', idempotencyKey: 'aigc-b', reason: 'retry' })).id, released.id);
  const summary = await ledger.summary('tenant-a');
  assert.equal(summary.plan?.remainingPoints, Object.values({ ...allocations, content_production: 30 }).reduce((sum, value) => sum + value, 0));
  assert.equal(summary.addon.remainingPoints, 100);
});

test('included work cannot silently drain a more expensive add-on and reused library media is free', async () => {
  const { ledger } = await fixture();
  await ledger.grantAddon({ tenantId: 'tenant-a', points: 1_000, purchaseId: 'purchase-a', idempotencyKey: 'purchase-a' });
  await assert.rejects(
    ledger.reserve({ tenantId: 'tenant-a', operationId: 'weekly-plan', idempotencyKey: 'weekly-plan', featureRateId: 'weekly-operating-plan', quantity: 1 }),
    (error: unknown) => error instanceof CustomerPointsError && error.code === 'customer_points_plan_included_quota_exhausted',
  );
  const free = await ledger.reserve({
    tenantId: 'tenant-a', operationId: 'reuse-a', idempotencyKey: 'reuse-a',
    featureRateId: 'material-library-reuse', quantity: 600,
  });
  assert.equal(free.quotedPoints, 0);
  assert.deepEqual(free.allocation, { planPoints: 0, addonPoints: 0 });
});

test('atomic reservations prevent concurrent overbooking', async () => {
  const { ledger } = await fixture({ ...allocations, content_production: 15 });
  const attempts = await Promise.allSettled(['a', 'b'].map(id => ledger.reserve({
    tenantId: 'tenant-a', operationId: `script-${id}`, idempotencyKey: `script-${id}`,
    featureRateId: 'script-storyboard-generation', quantity: 1,
  })));
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(result => result.status === 'rejected').length, 1);
  assert.equal((await ledger.summary('tenant-a')).plan?.reservedPoints, 15);
});

test('a finished monthly cycle renews atomically while preserving purchased add-on points', async () => {
  const store = new MemoryStore();
  let current = new Date(now);
  const ledger = createCustomerPointsLedger(store, () => new Date(current));
  await ledger.provisionPlan({
    tenantId: 'tenant-a', planId: 'professional-monthly', planLabel: '专业版',
    cycleStartsAt: '2026-10-01T00:00:00.000Z', cycleEndsAt: '2026-11-01T00:00:00.000Z',
    allocations, idempotencyKey: 'plan-2026-10',
  });
  await ledger.grantAddon({ tenantId: 'tenant-a', points: 200, purchaseId: 'purchase-a', idempotencyKey: 'purchase-a' });
  await ledger.reserve({ tenantId: 'tenant-a', operationId: 'script-a', idempotencyKey: 'script-a', featureRateId: 'script-storyboard-generation', quantity: 1 });
  await ledger.settle({ tenantId: 'tenant-a', idempotencyKey: 'script-a', actualQuantity: 1 });

  current = new Date('2026-11-01T00:00:01.000Z');
  const renewed = await ledger.provisionPlan({
    tenantId: 'tenant-a', planId: 'professional-monthly', planLabel: '专业版',
    cycleStartsAt: '2026-11-01T00:00:00.000Z', cycleEndsAt: '2026-12-01T00:00:00.000Z',
    allocations: { ...allocations, content_production: 120 }, idempotencyKey: 'plan-2026-11',
  });
  assert.equal(renewed.plan?.usedPoints, 0);
  assert.equal(renewed.sections.find(section => section.id === 'content_production')?.totalPoints, 120);
  assert.equal(renewed.addon.remainingPoints, 200);
  assert.deepEqual(
    (store.rows.get(CUSTOMER_POINTS_EVENTS) ?? []).filter(row => row.event_type === 'plan_provisioned').map(row => row.event_id),
    ['plan:plan-2026-10', 'plan:plan-2026-11'],
  );
});

test('customer summary never exposes provider names or RMB cost fields', async () => {
  const { ledger } = await fixture();
  const json = JSON.stringify(await ledger.summary('tenant-a'));
  assert.doesNotMatch(json, /provider|model|token|cny|rmb|yuan|seedance|heygen/i);
  assert.match(json, /remainingPoints/);
});
