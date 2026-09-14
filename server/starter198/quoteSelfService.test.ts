import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type {
  Starter198QuoteInquiryInput,
  Starter198QuoteRuleSetupInput,
  Starter198ResourceLimits,
} from '../../shared/contracts/starter198.js';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { STARTER_198_CAPABILITIES, STARTER_198_PROFILE_VERSION } from '../../shared/contracts/starter198.js';
import { STARTER_198_DEFAULT_LIMITS } from './provisioning.js';
import { STARTER_COLLECTIONS } from './repository.js';
import { Starter198RuntimePortError } from './runtimePorts.js';
import { createStarter198QuoteSelfServicePort } from './quoteSelfService.js';

type Row = Record_ & Record<string, unknown>;

class MemoryStore implements DataStore {
  private sequence = 0;
  readonly rows = new Map<string, Row[]>();

  seed(collection: string, data: Record<string, unknown>): Row {
    const row = {
      id: `record_${String(++this.sequence).padStart(6, '0')}`,
      ...structuredClone(data),
    } as Row;
    this.rows.set(collection, [...(this.rows.get(collection) ?? []), row]);
    return structuredClone(row);
  }

  collection(collection: string, tenantId?: string): Row[] {
    return structuredClone((this.rows.get(collection) ?? [])
      .filter(row => !tenantId || row.tenant_id === tenantId));
  }

  async getById<T = Record_>(collection: string, id: string): Promise<T | null> {
    const row = (this.rows.get(collection) ?? []).find(item => item.id === id);
    return row ? structuredClone(row) as T : null;
  }

  async create<T = Record_>(collection: string, data: Record<string, unknown>): Promise<T | null> {
    const current = this.rows.get(collection) ?? [];
    const tenant = data.tenant_id;
    const duplicate = collection === STARTER_COLLECTIONS.quoteRuleSets
      ? current.some(row => row.tenant_id === tenant && (
        (row.rule_set_key === data.rule_set_key && row.version === data.version)
        || row.idempotency_key === data.idempotency_key
      ))
      : collection === STARTER_COLLECTIONS.quoteDrafts
        ? current.some(row => row.tenant_id === tenant && row.idempotency_key === data.idempotency_key)
        : collection === STARTER_COLLECTIONS.quoteInquiries
          ? current.some(row => row.tenant_id === tenant && (
            (row.inquiry_id === data.inquiry_id && row.inquiry_version === data.inquiry_version)
            || (row.source_channel === data.source_channel
              && row.source_reference_hash === data.source_reference_hash
              && row.inquiry_version === data.inquiry_version)
            || row.idempotency_key === data.idempotency_key
          ))
          : collection === 'quote_exception_requests'
            ? current.some(row => row.tenant_id === tenant && (
              row.draft_id === data.draft_id || row.idempotency_key === data.idempotency_key
            ))
            : false;
    return duplicate ? null : this.seed(collection, data) as T;
  }

  async update(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
    const rows = this.rows.get(collection) ?? [];
    const index = rows.findIndex(row => row.id === id);
    if (index < 0) return false;
    rows[index] = { ...rows[index], ...structuredClone(data) };
    return true;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const rows = this.rows.get(collection) ?? [];
    const next = rows.filter(row => row.id !== id);
    this.rows.set(collection, next);
    return next.length !== rows.length;
  }

  async list<T = Record_>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    let rows = (this.rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {})
      .every(([key, value]) => String(row[key] ?? '') === String(value)));
    if (query.sort) {
      const descending = query.sort.startsWith('-');
      const key = descending ? query.sort.slice(1) : query.sort;
      rows = [...rows].sort((left, right) => {
        const result = String(left[key] ?? '').localeCompare(String(right[key] ?? ''));
        return descending ? -result : result;
      });
    }
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const offset = (page - 1) * perPage;
    return {
      items: structuredClone(rows.slice(offset, offset + perPage)) as T[],
      totalItems: rows.length,
      totalPages: rows.length ? Math.ceil(rows.length / perPage) : 0,
      page,
      perPage,
    };
  }
}

const BASE_SETUP: Starter198QuoteRuleSetupInput = Object.freeze({
  sku: 'SKU-198',
  currency: 'USD',
  unitPrice: '12.50',
  unitCost: '5.00',
  moq: 100,
  incoterm: 'FOB',
  shippingFlatFee: '20.00',
  taxRateBps: 0,
  paymentTerm: 'T/T 30% deposit, 70% before shipment',
  leadTimeDays: 21,
  validDays: 14,
  minMarginBps: 1000,
  sourceReference: 'catalog:2026-09',
});

const BASE_INQUIRY: Starter198QuoteInquiryInput = Object.freeze({
  sourceChannel: 'whatsapp',
  sourceReference: 'wa:lead-9001',
  quantity: 100,
  destinationCountry: 'DE',
});

function seedAccess(
  store: MemoryStore,
  tenantId: string,
  limits: Starter198ResourceLimits = STARTER_198_DEFAULT_LIMITS,
): void {
  store.seed(STARTER_COLLECTIONS.access, {
    tenant_id: tenantId,
    product_profile: 'starter_198',
    profile_version: STARTER_198_PROFILE_VERSION,
    entitlement_snapshot_id: `snapshot-${tenantId}`,
    feature_entitlements: STARTER_198_CAPABILITIES.map(capability => ({ capability, enabled: true })),
    resource_limits: limits,
    status: 'active',
    cycle_started_at: '2026-09-01T00:00:00.000Z',
    cycle_ends_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
  });
}

function fixture(input: {
  tenantIds?: string[];
  limits?: Starter198ResourceLimits;
} = {}) {
  const store = new MemoryStore();
  const tenantIds = input.tenantIds ?? ['tenant-a'];
  tenantIds.forEach(tenantId => seedAccess(store, tenantId, input.limits));
  let clock = new Date('2026-09-12T08:00:00.000Z');
  const port = createStarter198QuoteSelfServicePort({
    dataStore: store,
    now: () => new Date(clock),
  });
  return {
    store,
    port,
    setTime(value: string) { clock = new Date(value); },
  };
}

function ruleCommand(
  tenantId = 'tenant-a',
  setup: Starter198QuoteRuleSetupInput = BASE_SETUP,
  idempotencyKey = 'rule-command-0001',
) {
  return { tenantId, userId: `owner-${tenantId}`, role: 'owner' as const, setup, idempotencyKey };
}

function inquiryCommand(
  tenantId = 'tenant-a',
  inquiry: Starter198QuoteInquiryInput = BASE_INQUIRY,
  idempotencyKey = 'inquiry-command-0001',
) {
  return { tenantId, userId: `sales-${tenantId}`, role: 'customer_service' as const, inquiry, idempotencyKey };
}

function isRuntimeError(code: string, status: number) {
  return (error: unknown): boolean => error instanceof Starter198RuntimePortError
    && error.code === code
    && error.status === status;
}

test('rule confirmation canonicalizes decimals and is semantically idempotent', async () => {
  const { store, port, setTime } = fixture();
  const first = await port.confirmRule(ruleCommand());
  assert.deepEqual(first, {
    ruleSetKey: 'starter-default',
    ruleSetVersion: 'v1',
    sku: 'SKU-198',
    created: true,
  });

  setTime('2026-09-13T10:00:00.000Z');
  const replay = await port.confirmRule(ruleCommand('tenant-a', {
    ...BASE_SETUP,
    unitPrice: '12.5000',
    unitCost: '5',
    shippingFlatFee: '20.0',
  }, 'another-command-key'));
  assert.equal(replay.created, false);
  assert.equal(replay.ruleSetVersion, 'v1');
  assert.equal(store.collection(STARTER_COLLECTIONS.quoteRuleSets, 'tenant-a').length, 1);
  const stored = store.collection(STARTER_COLLECTIONS.quoteRuleSets, 'tenant-a')[0];
  const ruleSet = stored.rule_set as Record<string, unknown>;
  const skuRule = (ruleSet.skuRules as Array<Record<string, unknown>>)[0];
  assert.equal((skuRule.quantityTiers as Array<Record<string, unknown>>)[0].unitPrice, '12.5');
  assert.equal(skuRule.unitCost, '5');
});

test('manual quote is deterministic across wall-clock days and never persists the raw inquiry reference', async () => {
  const { store, port, setTime } = fixture();
  await port.confirmRule(ruleCommand());
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('network/provider access is forbidden in deterministic quotation');
  }) as typeof fetch;
  try {
    const first = await port.submitInquiry(inquiryCommand());
    assert.equal(first.status, 'draft_ready');
    assert.deepEqual(first.total, { currency: 'USD', decimal: '1270.00' });
    assert.equal(first.repeated, false);

    setTime('2026-09-18T16:30:00.000Z');
    const replay = await port.submitInquiry(inquiryCommand('tenant-a', BASE_INQUIRY, 'new-command-key'));
    assert.equal(replay.inquiryId, first.inquiryId);
    assert.equal(replay.inquiryVersion, first.inquiryVersion);
    assert.equal(replay.draftId, first.draftId);
    assert.deepEqual(replay.total, first.total);
    assert.equal(replay.repeated, true);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(fetchCalls, 0);
  const inquiries = store.collection(STARTER_COLLECTIONS.quoteInquiries, 'tenant-a');
  const drafts = store.collection(STARTER_COLLECTIONS.quoteDrafts, 'tenant-a');
  assert.equal(inquiries.length, 1);
  assert.equal(drafts.length, 1);
  assert.equal(String(inquiries[0].source_reference_hash).length, 64);
  assert.match(String(inquiries[0].source_reference_hint), /^whatsapp:[a-f0-9]{10}$/);
  for (const record of [...inquiries, ...drafts]) {
    assert.doesNotMatch(JSON.stringify(record), new RegExp(BASE_INQUIRY.sourceReference, 'i'));
  }
  assert.equal((drafts[0].input as Record<string, unknown>).quoteDate, '2026-09-12');
});

test('a new immutable rule can recalculate the same inquiry without duplicating its provenance', async () => {
  const { store, port } = fixture();
  await port.confirmRule(ruleCommand());
  const first = await port.submitInquiry(inquiryCommand());

  // Keep the same timestamp deliberately: the latest rule must still be
  // selected by the immutable record-id tie-breaker.
  const changedRule = await port.confirmRule(ruleCommand('tenant-a', {
    ...BASE_SETUP,
    unitPrice: '15.00',
  }, 'rule-command-0002'));
  assert.equal(changedRule.ruleSetVersion, 'v2');
  const recalculated = await port.submitInquiry(inquiryCommand('tenant-a', BASE_INQUIRY, 'inquiry-command-0002'));

  assert.notEqual(recalculated.draftId, first.draftId);
  assert.deepEqual(recalculated.total, { currency: 'USD', decimal: '1520.00' });
  assert.equal(recalculated.repeated, false);
  assert.equal(store.collection(STARTER_COLLECTIONS.quoteInquiries, 'tenant-a').length, 1);
  assert.equal(store.collection(STARTER_COLLECTIONS.quoteDrafts, 'tenant-a').length, 2);
});

test('a cycle rollover creates a fresh deterministic inquiry version instead of reviving an expired draft', async () => {
  const { store, port, setTime } = fixture();
  await port.confirmRule(ruleCommand());
  const first = await port.submitInquiry(inquiryCommand());
  const access = store.collection(STARTER_COLLECTIONS.access, 'tenant-a')[0];
  await store.update(STARTER_COLLECTIONS.access, access.id, {
    entitlement_snapshot_id: 'snapshot-tenant-a-cycle-2',
    cycle_started_at: '2026-10-01T00:00:00.000Z',
    cycle_ends_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  });
  setTime('2026-10-02T08:00:00.000Z');

  const refreshed = await port.submitInquiry(inquiryCommand('tenant-a', BASE_INQUIRY, 'cycle-2-command'));
  assert.equal(refreshed.inquiryId, first.inquiryId);
  assert.notEqual(refreshed.inquiryVersion, first.inquiryVersion);
  assert.notEqual(refreshed.draftId, first.draftId);
  assert.equal(refreshed.repeated, false);
  assert.equal(store.collection(STARTER_COLLECTIONS.quoteInquiries, 'tenant-a').length, 2);
  assert.equal(store.collection(STARTER_COLLECTIONS.quoteDrafts, 'tenant-a').length, 2);
});

test('tenant scoping changes pseudonymous ids and prevents cross-tenant record reuse', async () => {
  const { store, port } = fixture({ tenantIds: ['tenant-a', 'tenant-b'] });
  await Promise.all([
    port.confirmRule(ruleCommand('tenant-a')),
    port.confirmRule(ruleCommand('tenant-b')),
  ]);
  const [left, right] = await Promise.all([
    port.submitInquiry(inquiryCommand('tenant-a')),
    port.submitInquiry(inquiryCommand('tenant-b')),
  ]);

  assert.notEqual(left.inquiryId, right.inquiryId);
  assert.notEqual(left.draftId, right.draftId);
  const leftSource = store.collection(STARTER_COLLECTIONS.quoteInquiries, 'tenant-a')[0];
  const rightSource = store.collection(STARTER_COLLECTIONS.quoteInquiries, 'tenant-b')[0];
  assert.notEqual(leftSource.source_reference_hash, rightSource.source_reference_hash);
  assert.equal(store.collection(STARTER_COLLECTIONS.quoteRuleSets, 'tenant-a').length, 1);
  assert.equal(store.collection(STARTER_COLLECTIONS.quoteRuleSets, 'tenant-b').length, 1);
});

test('standard rule and structured inquiry validation fail closed', async () => {
  const { port } = fixture();
  await assert.rejects(
    port.confirmRule(ruleCommand('tenant-a', { ...BASE_SETUP, unitPrice: '12.12345' })),
    isRuntimeError('starter_198_quote_rule_unit_price_invalid', 400),
  );
  await assert.rejects(
    port.confirmRule(ruleCommand('tenant-a', { ...BASE_SETUP, moq: 1.5 })),
    isRuntimeError('starter_198_quote_rule_moq_invalid', 400),
  );
  await port.confirmRule(ruleCommand());
  await assert.rejects(
    port.submitInquiry(inquiryCommand('tenant-a', { ...BASE_INQUIRY, sourceReference: '13800138000' })),
    isRuntimeError('starter_198_quote_inquiry_invalid', 400),
  );
  await assert.rejects(
    port.submitInquiry(inquiryCommand('tenant-a', { ...BASE_INQUIRY, destinationCountry: 'DEU' })),
    isRuntimeError('starter_198_quote_inquiry_invalid', 400),
  );
  await assert.rejects(
    port.submitInquiry(inquiryCommand('tenant-a', { ...BASE_INQUIRY, quantity: 0 })),
    isRuntimeError('starter_198_quote_inquiry_quantity_invalid', 400),
  );
});

test('draft quota rejects before persisting a second inquiry and still permits an exact retry', async () => {
  const limits: Starter198ResourceLimits = {
    ...STARTER_198_DEFAULT_LIMITS,
    quoteDraftCountPerCycle: 1,
  };
  const { store, port } = fixture({ limits });
  await port.confirmRule(ruleCommand());
  const first = await port.submitInquiry(inquiryCommand());
  const retry = await port.submitInquiry(inquiryCommand('tenant-a', BASE_INQUIRY, 'retry-at-quota'));
  assert.equal(retry.draftId, first.draftId);
  assert.equal(retry.repeated, true);

  await assert.rejects(
    port.submitInquiry(inquiryCommand('tenant-a', {
      ...BASE_INQUIRY,
      sourceReference: 'wa:lead-9002',
    }, 'new-inquiry-at-quota')),
    isRuntimeError('starter_198_quote_draft_quota_exceeded', 409),
  );
  assert.equal(store.collection(STARTER_COLLECTIONS.quoteInquiries, 'tenant-a').length, 1);
  assert.equal(store.collection(STARTER_COLLECTIONS.quoteDrafts, 'tenant-a').length, 1);
});

test('migration stores only pseudonymous inquiry provenance behind tenant-scoped uniqueness', async () => {
  const migration = await readFile(
    new URL('../../pb_migrations/1789603201_create_starter_quote_inquiries.js', import.meta.url),
    'utf8',
  );
  assert.match(migration, /text\("source_reference_hash", true\)/);
  assert.match(migration, /text\("source_reference_hint", true\)/);
  assert.doesNotMatch(migration, /text\("source_reference",/);
  assert.doesNotMatch(migration, /text\("(?:message|phone|email|contact)",/);
  assert.match(migration, /\(tenant_id, source_channel, source_reference_hash, inquiry_version\)/);
  assert.match(migration, /\(tenant_id, idempotency_key\)/);
});
