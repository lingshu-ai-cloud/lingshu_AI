import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { store as applicationStore } from '../storage/index.js';
import { QuotationService, type DraftView } from '../quotation/service.js';
import type { QuoteRuleSetInput } from '../quotation/types.js';
import {
  STARTER_198_CAPABILITIES,
  STARTER_198_PROFILE_VERSION,
} from '../../shared/contracts/starter198.js';
import { STARTER_198_DEFAULT_LIMITS } from './provisioning.js';
import {
  currentStarterQuoteArtifact,
  ensureStarterQuoteArtifact,
  readStarterQuoteArtifact,
  type StarterQuoteArtifact,
} from './quoteArtifact.js';
import { runStarterQuoteArtifactCycle } from './quoteArtifactWorker.js';
import { createStarter198QuoteDecisionPort } from './quoteDecision.js';
import { createStarter198QuoteEvidencePort } from './quoteEvidence.js';
import { isStarter198BoundaryExemptPath } from './legacyBoundary.js';
import { createStarter198Repository, STARTER_COLLECTIONS } from './repository.js';
import { Starter198RuntimePortError } from './runtimePorts.js';
import { starterWorkerRuntimeIssue, type StarterWorkerEnabledFlag } from './workerRuntime.js';
import { starterWorkerDataStore } from './workerStorage.js';

type Row = Record_ & Record<string, unknown>;

class MemoryStore implements DataStore {
  private sequence = 0;
  readonly rows = new Map<string, Row[]>();
  readonly listQueries: Array<{ collection: string; query: ListQuery }> = [];

  seed(collection: string, data: Record<string, unknown>): Row {
    const row = { id: `record_${String(++this.sequence).padStart(6, '0')}`, ...structuredClone(data) } as Row;
    this.rows.set(collection, [...(this.rows.get(collection) ?? []), row]);
    return structuredClone(row);
  }

  collection(collection: string): Row[] {
    return structuredClone(this.rows.get(collection) ?? []);
  }

  async getById<T = Record_>(collection: string, id: string): Promise<T | null> {
    const row = (this.rows.get(collection) ?? []).find(item => item.id === id);
    return row ? structuredClone(row) as T : null;
  }

  async create<T = Record_>(collection: string, data: Record<string, unknown>): Promise<T | null> {
    const current = this.rows.get(collection) ?? [];
    if (collection === STARTER_COLLECTIONS.quoteArtifacts) {
      const duplicate = current.some(row => (
        row.tenant_id === data.tenant_id
        && (row.draft_id === data.draft_id
          || row.artifact_id === data.artifact_id
          || row.idempotency_key === data.idempotency_key)
      ));
      if (duplicate) return null;
    }
    return this.seed(collection, data) as T;
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
    this.listQueries.push({ collection, query: structuredClone(query) });
    let rows = (this.rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {})
      .every(([key, value]) => String(row[key] ?? '') === String(value)));
    if (query.sort) {
      const fields = query.sort.split(',').map(field => ({
        descending: field.startsWith('-'),
        key: field.startsWith('-') ? field.slice(1) : field,
      }));
      rows = [...rows].sort((left, right) => {
        for (const field of fields) {
          const result = String(left[field.key] ?? '').localeCompare(String(right[field.key] ?? ''));
          if (result) return field.descending ? -result : result;
        }
        return 0;
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

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function stablePretty(value: unknown, depth = 0): string {
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    const indent = '  '.repeat(depth + 1);
    return `[\n${indent}${value.map(item => stablePretty(item, depth + 1)).join(`,\n${indent}`)}\n${'  '.repeat(depth)}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (!keys.length) return '{}';
    const indent = '  '.repeat(depth + 1);
    return `{\n${indent}${keys.map(key => `${JSON.stringify(key)}: ${stablePretty(record[key], depth + 1)}`).join(`,\n${indent}`)}\n${'  '.repeat(depth)}}`;
  }
  return JSON.stringify(value);
}

function seedStarterAccess(store: MemoryStore, tenantId: string): void {
  store.seed(STARTER_COLLECTIONS.access, {
    tenant_id: tenantId,
    product_profile: 'starter_198',
    profile_version: STARTER_198_PROFILE_VERSION,
    entitlement_snapshot_id: `snapshot-${tenantId}`,
    feature_entitlements: STARTER_198_CAPABILITIES.map(capability => ({ capability, enabled: true })),
    resource_limits: STARTER_198_DEFAULT_LIMITS,
    status: 'active',
    cycle_started_at: '2026-09-01T00:00:00.000Z',
    cycle_ends_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-09-12T00:00:00.000Z',
  });
}

function ruleSet(tenantId: string): QuoteRuleSetInput {
  return {
    schemaVersion: '1.0',
    ruleSetKey: `starter-rule-${tenantId}`,
    version: 'v1',
    status: 'confirmed',
    productId: `product-${tenantId}`,
    baseCurrency: 'USD',
    fxSnapshot: {
      id: `fx-${tenantId}-v1`,
      asOf: '2026-09-12',
      rates: { USD: '1' },
      sourceRefs: [`fx-source-${tenantId}`],
    },
    skuRules: [{
      sku: 'SKU-1',
      requiredSpecifications: { color: ['black'] },
      moq: 10,
      quantityTiers: [{ minQuantity: 1, unitPrice: '4.55' }],
      unitCost: '2.00',
      incoterms: [{ code: 'FOB', flatFee: '180', perUnitFee: '0', leadTimeDays: 14 }],
      shippingRules: [{ destinationCountry: '*', incoterm: '*', flatFee: '0', perUnitFee: '0' }],
      taxRateBps: 0,
      taxBasis: 'goods_and_shipping',
      allowedPaymentTerms: ['TT30'],
      standardLeadTimeDays: 14,
      maxDiscountBps: 0,
      minMarginBps: 3000,
      validDays: 30,
    }],
    sourceRefs: [`confirmed-product-${tenantId}`],
  };
}

async function quoteFixture(input: {
  tenantId: string;
  approved: boolean;
  provisioned?: boolean;
  store?: MemoryStore;
  inquiryId?: string;
}): Promise<{ store: MemoryStore; service: QuotationService; draft: DraftView }> {
  const store = input.store ?? new MemoryStore();
  if (input.provisioned !== false) seedStarterAccess(store, input.tenantId);
  store.seed('tenant_profiles', {
    tenant_id: input.tenantId,
    profile: { company: { name: `供应商 ${input.tenantId}` } },
  });
  const service = new QuotationService(store, () => new Date('2026-09-12T08:00:00.000Z'));
  const actor = { tenantId: input.tenantId, userId: `owner-${input.tenantId}`, role: 'admin' as const };
  const rules = ruleSet(input.tenantId);
  await service.createRuleSet(actor, rules, `rule-create-${input.tenantId}`);
  let draft = await service.createDraft(actor, {
    ruleSetKey: rules.ruleSetKey,
    ruleSetVersion: rules.version,
    input: {
      inquiryId: input.inquiryId ?? `inquiry-${input.tenantId}`,
      inquiryVersion: '1',
      sku: 'SKU-1',
      specifications: { color: 'black' },
      quantity: 100,
      quoteCurrency: 'USD',
      incoterm: 'FOB',
      destinationCountry: 'DE',
      paymentTerm: 'TT30',
      quoteDate: '2026-09-12',
    },
  }, `draft-create-${input.tenantId}-${input.inquiryId ?? 'one'}`);
  if (input.approved) {
    await service.decideDraft(
      actor,
      draft.id,
      `draft-approve-${input.tenantId}-${input.inquiryId ?? 'one'}`,
      'approved',
      '已核对确定性金额与条款。',
      draft.inputHash,
    );
    draft = await service.getDraft(actor, draft.id);
  }
  return { store, service, draft };
}

function runtimeError(code: string, status: number) {
  return (error: unknown): boolean => error instanceof Starter198RuntimePortError
    && error.code === code
    && error.status === status;
}

test('approved quote artifact persists the exact downloadable bytes and their SHA-256', async () => {
  const tenantId = 'starter-byte-tenant';
  const { store, service, draft } = await quoteFixture({ tenantId, approved: true });
  const requestTime = '2026-09-12T09:30:00.000Z';
  const generatedAt = new Date(draft.updatedAt).toISOString();
  const result = await ensureStarterQuoteArtifact({
    tenantId,
    userId: `owner-${tenantId}`,
    draftId: draft.id,
    expectedInputHash: draft.inputHash,
    idempotencyKey: 'quote-artifact-byte-test',
    dataStore: store,
    quotationService: service,
    now: new Date(requestTime),
  });

  const expectedDocument = {
    schemaVersion: 'starter-198.quote-artifact.v1',
    documentType: 'quotation',
    quoteNumber: draft.id,
    supplier: `供应商 ${tenantId}`,
    inquiryReference: draft.inquiryId,
    status: 'approved',
    generatedAt,
    validFrom: draft.calculation.validFrom,
    validUntil: draft.calculation.validUntil,
    product: {
      sku: draft.input.sku,
      specifications: draft.input.specifications,
      quantity: draft.input.quantity,
    },
    commercialTerms: {
      currency: draft.input.quoteCurrency,
      incoterm: draft.input.incoterm,
      destinationCountry: draft.input.destinationCountry,
      paymentTerm: draft.input.paymentTerm,
      leadTimeDays: draft.calculation.promisedLeadTimeDays,
    },
    amounts: {
      unitPrice: draft.calculation.unitPrice,
      goodsSubtotal: draft.calculation.goodsSubtotal,
      discount: draft.calculation.discount,
      incotermFee: draft.calculation.incotermFee,
      shipping: draft.calculation.shipping,
      tax: draft.calculation.tax,
      total: draft.calculation.total,
    },
    immutableEvidence: {
      ruleSet: draft.ruleSetRef,
      inputHash: draft.inputHash,
      calculationHash: draft.calculationHash,
      approvalEvidenceId: draft.approvalEvidenceId,
    },
    notice: '本文件来自已确认规则的确定性计算。对外发送由用户在系统外完成，系统不会自动承诺或发送。',
  };
  const expectedBytes = Buffer.from(`${stablePretty(expectedDocument)}\n`, 'utf8');
  assert.equal(result.created, true);
  assert.deepEqual(result.artifact.bytes, expectedBytes);
  assert.equal(result.artifact.sha256, sha256(expectedBytes));
  assert.equal(result.artifact.inputHash, draft.inputHash);
  assert.equal(result.artifact.ruleHash, draft.ruleSetRef.hash);
  assert.equal(result.artifact.calculationHash, draft.calculationHash);
  assert.equal(result.artifact.approvalEvidenceId, draft.approvalEvidenceId);

  const stored = store.collection(STARTER_COLLECTIONS.quoteArtifacts);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].sha256, result.artifact.sha256);
  assert.deepEqual(Buffer.from(String(stored[0].body_base64), 'base64'), expectedBytes);
  const downloaded = await readStarterQuoteArtifact({
    tenantId,
    artifactId: result.artifact.artifactId,
    repository: createStarter198Repository(store),
  });
  assert.ok(downloaded);
  assert.deepEqual(downloaded.bytes, expectedBytes);
  assert.equal(sha256(downloaded.bytes), downloaded.sha256);
});

test('same artifact command replays one immutable byte stream without a duplicate row', async () => {
  const tenantId = 'starter-replay-tenant';
  const { store, service, draft } = await quoteFixture({ tenantId, approved: true });
  const repository = createStarter198Repository(store);
  const first = await ensureStarterQuoteArtifact({
    tenantId, userId: `owner-${tenantId}`, draftId: draft.id,
    expectedInputHash: draft.inputHash, idempotencyKey: 'quote-artifact-replay',
    dataStore: store, repository, quotationService: service,
    now: new Date('2026-09-12T10:00:00.000Z'),
  });
  const replay = await ensureStarterQuoteArtifact({
    tenantId, userId: `owner-${tenantId}`, draftId: draft.id,
    expectedInputHash: draft.inputHash, idempotencyKey: 'quote-artifact-replay',
    dataStore: store, repository, quotationService: service,
    now: new Date('2026-09-13T10:00:00.000Z'),
  });
  assert.equal(first.created, true);
  assert.equal(replay.created, false);
  assert.equal(replay.artifact.artifactId, first.artifact.artifactId);
  assert.equal(replay.artifact.sha256, first.artifact.sha256);
  assert.deepEqual(replay.artifact.bytes, first.artifact.bytes);
  assert.equal(store.collection(STARTER_COLLECTIONS.quoteArtifacts).length, 1);
});

test('unapproved quote cannot produce a downloadable artifact', async () => {
  const tenantId = 'starter-unapproved-tenant';
  const { store, service, draft } = await quoteFixture({ tenantId, approved: false });
  await assert.rejects(() => ensureStarterQuoteArtifact({
    tenantId, userId: `owner-${tenantId}`, draftId: draft.id,
    expectedInputHash: draft.inputHash, idempotencyKey: 'quote-artifact-unapproved',
    dataStore: store, quotationService: service,
  }), runtimeError('starter_198_quote_artifact_not_approved', 409));
  assert.equal(store.collection(STARTER_COLLECTIONS.quoteArtifacts).length, 0);
});

test('a changed displayed input hash is rejected before artifact creation', async () => {
  const tenantId = 'starter-changed-tenant';
  const { store, service, draft } = await quoteFixture({ tenantId, approved: true });
  await assert.rejects(() => ensureStarterQuoteArtifact({
    tenantId, userId: `owner-${tenantId}`, draftId: draft.id,
    expectedInputHash: '0'.repeat(64), idempotencyKey: 'quote-artifact-changed',
    dataStore: store, quotationService: service,
  }), runtimeError('quote_draft_changed', 409));
  assert.equal(store.collection(STARTER_COLLECTIONS.quoteArtifacts).length, 0);
});

test('artifact reads and creation remain tenant scoped', async () => {
  const victimTenant = 'starter-victim-tenant';
  const attackerTenant = 'starter-attacker-tenant';
  const { store, service, draft } = await quoteFixture({ tenantId: victimTenant, approved: true });
  seedStarterAccess(store, attackerTenant);
  const created = await ensureStarterQuoteArtifact({
    tenantId: victimTenant, userId: `owner-${victimTenant}`, draftId: draft.id,
    expectedInputHash: draft.inputHash, idempotencyKey: 'quote-artifact-victim',
    dataStore: store, quotationService: service,
  });
  const repository = createStarter198Repository(store);
  assert.equal(await readStarterQuoteArtifact({
    tenantId: attackerTenant, artifactId: created.artifact.artifactId, repository,
  }), null);
  assert.equal(await currentStarterQuoteArtifact({
    tenantId: attackerTenant, draftId: draft.id, repository,
  }), null);
  await assert.rejects(() => ensureStarterQuoteArtifact({
    tenantId: attackerTenant, userId: `owner-${attackerTenant}`, draftId: draft.id,
    expectedInputHash: draft.inputHash, idempotencyKey: 'quote-artifact-attacker',
    dataStore: store, repository, quotationService: service,
  }), (error: unknown) => (
    error instanceof Starter198RuntimePortError
    && error.code === 'quote_draft_not_found'
    && error.status === 404
  ));
  assert.equal(store.collection(STARTER_COLLECTIONS.quoteArtifacts)
    .filter(row => row.tenant_id === attackerTenant).length, 0);
});

test('non-starter tenant is rejected even when it has an approved quote', async () => {
  const tenantId = 'advanced-nonstarter-tenant';
  const { store, service, draft } = await quoteFixture({ tenantId, approved: true, provisioned: false });
  await assert.rejects(() => ensureStarterQuoteArtifact({
    tenantId, userId: `owner-${tenantId}`, draftId: draft.id,
    expectedInputHash: draft.inputHash, idempotencyKey: 'quote-artifact-nonstarter',
    dataStore: store, quotationService: service,
  }), runtimeError('starter_198_not_provisioned', 403));
  assert.equal(store.collection(STARTER_COLLECTIONS.quoteArtifacts).length, 0);
});

test('artifact repair worker cannot create starter artifacts for non-starter quote drafts', async () => {
  const store = new MemoryStore();
  await quoteFixture({
    tenantId: 'starter-worker-tenant', approved: true, store,
  });
  await quoteFixture({
    tenantId: 'advanced-worker-tenant', approved: true, provisioned: false, store,
  });
  const result = await runStarterQuoteArtifactCycle({ dataStore: store, maxDrafts: 10 });
  const artifacts = store.collection(STARTER_COLLECTIONS.quoteArtifacts);
  assert.equal(result.created, 1);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].tenant_id, 'starter-worker-tenant');
  assert.equal(artifacts.some(row => row.tenant_id === 'advanced-worker-tenant'), false);
});

test('artifact repair worker fails closed when the supplier profile dependency is missing', async () => {
  const tenantId = 'starter-worker-missing-profile';
  const fixture = await quoteFixture({ tenantId, approved: true });
  fixture.store.rows.set('tenant_profiles', []);
  const result = await runStarterQuoteArtifactCycle({ dataStore: fixture.store, maxDrafts: 10 });
  assert.equal(result.created, 0);
  assert.deepEqual(result.failed, [{
    tenantId,
    draftId: fixture.draft.id,
    code: 'starter_198_quote_artifact_profile_missing',
  }]);
  assert.equal(fixture.store.collection(STARTER_COLLECTIONS.quoteArtifacts).length, 0);
});

test('starter repair workers require exact opt-in and complete production storage dependencies', () => {
  const flags: StarterWorkerEnabledFlag[] = [
    'STARTER_198_ORCHESTRATOR_WORKER_ENABLED',
    'STARTER_PUBLICATION_PACKAGE_WORKER_ENABLED',
    'STARTER_QUOTE_ARTIFACT_WORKER_ENABLED',
  ];
  for (const flag of flags) {
    assert.equal(starterWorkerRuntimeIssue(flag, {}), 'not_explicitly_enabled');
    assert.equal(starterWorkerRuntimeIssue(flag, { [flag]: 'TRUE' }), 'not_explicitly_enabled');
    assert.equal(starterWorkerRuntimeIssue(flag, { [flag]: '1' }), 'not_explicitly_enabled');
    assert.equal(starterWorkerRuntimeIssue(flag, { [flag]: 'true', NODE_ENV: 'test' }), null);
    assert.equal(starterWorkerRuntimeIssue(flag, { [flag]: 'true', NODE_ENV: 'production' }), 'production_dependency_missing:PB_URL');
    assert.equal(starterWorkerRuntimeIssue(flag, {
      [flag]: 'true', NODE_ENV: 'production', PB_URL: 'http://pocketbase:8090',
    }), 'production_dependency_missing:PB_ADMIN_EMAIL');
    assert.equal(starterWorkerRuntimeIssue(flag, {
      [flag]: 'true', NODE_ENV: 'production', PB_URL: 'http://pocketbase:8090',
      PB_ADMIN_EMAIL: 'worker@example.test',
    }), 'production_dependency_missing:PB_ADMIN_PASSWORD');
    assert.equal(starterWorkerRuntimeIssue(flag, {
      [flag]: 'true', NODE_ENV: 'production', PB_URL: 'file:///tmp/not-pocketbase',
      PB_ADMIN_EMAIL: 'worker@example.test', PB_ADMIN_PASSWORD: 'secret',
    }), 'production_dependency_invalid:PB_URL');
    assert.equal(starterWorkerRuntimeIssue(flag, {
      [flag]: 'true', NODE_ENV: 'production', PB_URL: 'http://pocketbase:8090',
      PB_ADMIN_EMAIL: 'worker@example.test', PB_ADMIN_PASSWORD: 'secret',
    }), null);
  }
});

test('production quote worker scan fails closed instead of reading a local fallback', { concurrency: false }, async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    PB_URL: process.env.PB_URL,
    PB_ADMIN_EMAIL: process.env.PB_ADMIN_EMAIL,
    PB_ADMIN_PASSWORD: process.env.PB_ADMIN_PASSWORD,
  };
  const originalFetch = globalThis.fetch;
  try {
    process.env.NODE_ENV = 'production';
    process.env.PB_URL = 'https://pocketbase.invalid';
    process.env.PB_ADMIN_EMAIL = 'worker@example.test';
    process.env.PB_ADMIN_PASSWORD = 'not-a-real-secret';
    globalThis.fetch = async () => new Response('dependency unavailable', { status: 503 });
    await assert.rejects(
      () => runStarterQuoteArtifactCycle(),
      /starter_198_access read failed \(503\)/,
    );
    const strictStore = starterWorkerDataStore(applicationStore);
    assert.notEqual(strictStore, applicationStore, 'production workers replace the fallback-capable application store');
    await assert.rejects(
      () => strictStore.create(STARTER_COLLECTIONS.quoteArtifacts, { tenant_id: 'must-not-fall-back' }),
      /starter_quote_artifacts create failed \(503\)/,
      'failed durable writes must not spill into the local JSON fallback',
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('artifact repair worker does not starve later approved drafts behind an existing first page', async () => {
  const store = new MemoryStore();
  const older = await quoteFixture({ tenantId: 'starter-worker-aaa-existing', approved: true, store });
  await ensureStarterQuoteArtifact({
    tenantId: 'starter-worker-aaa-existing', userId: 'owner-starter-worker-aaa-existing', draftId: older.draft.id,
    expectedInputHash: older.draft.inputHash, idempotencyKey: 'quote-artifact-worker-old',
    dataStore: store, quotationService: older.service,
  });
  const later = await quoteFixture({ tenantId: 'starter-worker-zzz-later', approved: true, store });

  const first = await runStarterQuoteArtifactCycle({ dataStore: store, maxDrafts: 1 });
  assert.equal(first.existing, 1);
  assert.ok(first.nextCursor);
  await runStarterQuoteArtifactCycle({ dataStore: store, maxDrafts: 1, cursor: first.nextCursor });

  const laterArtifact = await currentStarterQuoteArtifact({
    tenantId: 'starter-worker-zzz-later',
    draftId: later.draft.id,
    expectedInputHash: later.draft.inputHash,
    repository: createStarter198Repository(store),
  });
  assert.ok(laterArtifact, 'a bounded worker must make forward progress instead of rescanning the same existing draft forever');
});

test('artifact repair cursor advances beyond 500 approved rows with a hard per-cycle bound', async () => {
  const store = new MemoryStore();
  const tenantId = 'starter-worker-over-500';
  for (let index = 0; index < 500; index += 1) {
    store.seed(STARTER_COLLECTIONS.quoteDrafts, {
      tenant_id: tenantId,
      status: 'approved',
      input_hash: '',
      updated_at: new Date(Date.parse('2026-09-01T00:00:00.000Z') + index).toISOString(),
    });
  }
  const later = await quoteFixture({ tenantId, approved: true, store, inquiryId: 'inquiry-after-500' });
  store.listQueries.length = 0;
  let cursor: string | null = null;
  let totalScanned = 0;
  for (let cycle = 0; cycle < 6; cycle += 1) {
    const result = await runStarterQuoteArtifactCycle({
      dataStore: store, maxDrafts: 100, maxTenants: 1, cursor,
    });
    assert.ok(result.scanned <= 100, 'one cycle must never exceed its draft budget');
    assert.ok(result.tenantsScanned <= 1, 'one cycle must never exceed its tenant budget');
    assert.equal(result.failed.some(item => item.code === 'starter_198_quote_artifact_scan_truncated'), false);
    totalScanned += result.scanned;
    cursor = result.nextCursor;
  }
  assert.equal(totalScanned, 501);
  assert.equal(store.listQueries.filter(call => call.collection === STARTER_COLLECTIONS.quoteDrafts
    && call.query.where?.status === 'approved' && call.query.perPage === 100).length, 6,
  'each 100-row scan page is loaded once rather than once per draft');
  const artifact = await currentStarterQuoteArtifact({
    tenantId,
    draftId: later.draft.id,
    expectedInputHash: later.draft.inputHash,
    repository: createStarter198Repository(store),
  });
  assert.ok(artifact, 'the 501st approved quote must be reached instead of being permanently hidden behind page one');
});

test('artifact repair rejects malformed cursors instead of silently restarting page one', async () => {
  await assert.rejects(
    () => runStarterQuoteArtifactCycle({ dataStore: new MemoryStore(), cursor: 'not-a-valid-cursor' }),
    /starter_198_quote_artifact_cursor_invalid/,
  );
  const validCursor = Buffer.from(JSON.stringify({
    schemaVersion: 'starter-198.quote-artifact-scan.v1',
    accessPage: 1,
    accessOffset: 0,
    draftPage: 1,
    draftOffset: 0,
  }), 'utf8').toString('base64url');
  await assert.rejects(
    () => runStarterQuoteArtifactCycle({ dataStore: new MemoryStore(), cursor: `${validCursor}!` }),
    /starter_198_quote_artifact_cursor_invalid/,
  );
  await assert.rejects(
    () => runStarterQuoteArtifactCycle({ dataStore: new MemoryStore(), cursor: 'a'.repeat(513) }),
    /starter_198_quote_artifact_cursor_invalid/,
  );
});

test('quote evidence derives the file hash server-side and preserves version binding', async () => {
  const bytes = Buffer.from('{"approved":true}\n', 'utf8');
  const artifact: StarterQuoteArtifact = {
    artifactId: 'quote_artifact_test',
    draftId: 'draft-test',
    inputHash: '1'.repeat(64),
    ruleHash: '2'.repeat(64),
    calculationHash: '3'.repeat(64),
    approvalEvidenceId: 'approval-test',
    sha256: sha256(bytes),
    mediaType: 'application/json; charset=utf-8',
    fileName: 'quotation-draft-test.json',
    bytes,
    createdAt: '2026-09-12T00:00:00.000Z',
  };
  let serviceArguments: unknown[] = [];
  const port = createStarter198QuoteEvidencePort({
    async recordExternalSendEvidence(...args: unknown[]) {
      serviceArguments = args;
      return { id: 'send-evidence-test', status: 'submitted_unverified' } as never;
    },
  }, async input => input.tenantId === 'starter-evidence-tenant'
    && input.draftId === artifact.draftId
    && input.expectedInputHash === artifact.inputHash ? artifact : null);
  const result = await port.record({
    tenantId: 'starter-evidence-tenant',
    userId: 'sales-owner',
    role: 'customer_service',
    draftId: artifact.draftId,
    expectedInputHash: artifact.inputHash,
    channel: 'Email',
    providerReference: 'message-42',
    idempotencyKey: 'quote-evidence-server-hash',
  });
  assert.deepEqual(result, { evidenceId: 'send-evidence-test', status: 'submitted_unverified' });
  assert.deepEqual(serviceArguments[3], {
    channel: 'Email',
    artifactHash: artifact.sha256,
    providerReference: 'message-42',
  });
  assert.equal(serviceArguments[4], artifact.inputHash);
});

test('quote evidence reports an artifact/version conflict as a client conflict, not persistence outage', async () => {
  const port = createStarter198QuoteEvidencePort({
    async recordExternalSendEvidence() {
      assert.fail('evidence service must not run without the bound current artifact');
    },
  }, async () => null);
  await assert.rejects(() => port.record({
    tenantId: 'starter-evidence-conflict',
    userId: 'sales-owner',
    role: 'customer_service',
    draftId: 'draft-conflict',
    expectedInputHash: '9'.repeat(64),
    channel: 'Email',
    providerReference: 'message-43',
    idempotencyKey: 'quote-evidence-version-conflict',
  }), runtimeError('starter_198_quote_artifact_not_ready', 409));
});

test('quote decision passes the approved immutable input to artifact creation', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const bytes = Buffer.from('{}\n');
  const artifact: StarterQuoteArtifact = {
    artifactId: 'quote_artifact_decision', draftId: 'draft-decision', inputHash: 'a'.repeat(64),
    ruleHash: 'b'.repeat(64), calculationHash: 'c'.repeat(64), approvalEvidenceId: 'approval-decision',
    sha256: sha256(bytes), mediaType: 'application/json; charset=utf-8', fileName: 'quote.json', bytes,
    createdAt: '2026-09-12T00:00:00.000Z',
  };
  const port = createStarter198QuoteDecisionPort({
    async decideDraft() { return {} as never; },
  }, async input => {
    calls.push(input as unknown as Record<string, unknown>);
    return { artifact, created: true };
  });
  const result = await port.decide({
    tenantId: 'starter-decision-tenant', userId: 'owner-decision', role: 'owner',
    draftId: artifact.draftId, expectedInputHash: artifact.inputHash,
    decision: 'approved', note: '批准', idempotencyKey: 'quote-decision-artifact',
  });
  assert.deepEqual(result, { artifactId: artifact.artifactId, artifactPending: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tenantId, 'starter-decision-tenant');
  assert.equal(calls[0].draftId, artifact.draftId);
  assert.equal(calls[0].expectedInputHash, artifact.inputHash);
  assert.equal(calls[0].idempotencyKey, 'quote-decision-artifact:quote-artifact');
});

test('quote artifact migration keeps immutable tenant/draft/idempotency uniqueness', async () => {
  const migrationUrl = new URL('../../pb_migrations/1789603200_create_starter_quote_artifacts.js', import.meta.url);
  const migration = await readFile(migrationUrl, 'utf8');
  assert.match(migration, /CREATE UNIQUE INDEX idx_starter_quote_artifact_id ON starter_quote_artifacts \(tenant_id, artifact_id\)/);
  assert.match(migration, /CREATE UNIQUE INDEX idx_starter_quote_artifact_draft ON starter_quote_artifacts \(tenant_id, draft_id\)/);
  assert.match(migration, /CREATE UNIQUE INDEX idx_starter_quote_artifact_idempotency ON starter_quote_artifacts \(tenant_id, idempotency_key\)/);
  assert.match(migration, /listRule: null,\s*viewRule: null,\s*createRule: null,\s*updateRule: null,\s*deleteRule: null/);
});

test('authenticated quote artifact download remains reachable inside the starter-only HTTP surface', () => {
  assert.equal(
    isStarter198BoundaryExemptPath('/api/overseas/starter-198/quote-artifacts/quote_artifact_0123456789abcdef01234567/download'),
    true,
    'requireAuth runs the starter legacy boundary before the download handler; the exact read-only route must be allow-listed',
  );
});
