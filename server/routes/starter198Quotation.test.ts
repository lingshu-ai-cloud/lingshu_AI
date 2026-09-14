import assert from 'node:assert/strict';
import express from 'express';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { QuotationService } from '../quotation/service.js';
import type { QuoteRuleSetInput } from '../quotation/types.js';
import { createStarter198QuotationRouter } from './starter198Quotation.js';
import { STARTER_198_CAPABILITIES, STARTER_198_PROFILE, STARTER_198_PROFILE_VERSION, type Starter198Capability } from '../../shared/contracts/starter198.js';
import { STARTER_198_DEFAULT_LIMITS } from '../starter198/provisioning.js';
import type { Starter198AccessSnapshot } from '../starter198/profile.js';
import { createStarter198Repository, Starter198RepositoryError } from '../starter198/repository.js';
import { issueLocalIdentityTokenForTest } from '../auth/localIdentity.js';

class MemoryStore implements DataStore {
  private sequence = 0;
  readonly records = new Map<string, Record_[]>();
  writes = 0;

  async getById<T = Record_>(collection: string, id: string): Promise<T | null> {
    const record = (this.records.get(collection) ?? []).find(item => item.id === id);
    return record ? structuredClone(record) as T : null;
  }

  async create<T = Record_>(collection: string, data: Record<string, unknown>): Promise<T | null> {
    this.writes += 1;
    const record = { id: `record_${String(++this.sequence).padStart(4, '0')}`, ...structuredClone(data) } as Record_;
    this.records.set(collection, [...(this.records.get(collection) ?? []), record]);
    return structuredClone(record) as T;
  }

  async update(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
    this.writes += 1;
    const records = this.records.get(collection) ?? [];
    const index = records.findIndex(item => item.id === id);
    if (index < 0) return false;
    records[index] = { ...records[index], ...structuredClone(data) };
    return true;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    this.writes += 1;
    const records = this.records.get(collection) ?? [];
    const filtered = records.filter(item => item.id !== id);
    this.records.set(collection, filtered);
    return filtered.length !== records.length;
  }

  async list<T = Record_>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    let items = (this.records.get(collection) ?? []).filter(record => Object.entries(query.where ?? {})
      .every(([key, value]) => String(record[key] ?? '') === String(value)));
    const sort = query.sort;
    if (sort) {
      const descending = sort.startsWith('-');
      const field = descending ? sort.slice(1) : sort;
      items = [...items].sort((left, right) => {
        const comparison = String(left[field] ?? '').localeCompare(String(right[field] ?? ''));
        return descending ? -comparison : comparison;
      });
    }
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const start = (page - 1) * perPage;
    return {
      items: structuredClone(items.slice(start, start + perPage)) as T[],
      totalItems: items.length,
      totalPages: Math.ceil(items.length / perPage),
      page,
      perPage,
    };
  }

  collection(name: string): Record_[] {
    return this.records.get(name) ?? [];
  }
}

function token(tenantId: string, role?: string): string {
  return issueLocalIdentityTokenForTest({
    userId: `${tenantId}-${role || 'missing'}-user`,
    tenantId,
    ...(role ? { role } : {}),
  });
}

function ruleSet(version: string, unitPrice: string): QuoteRuleSetInput {
  return {
    schemaVersion: '1.0',
    ruleSetKey: 'starter-product',
    version,
    status: 'confirmed',
    productId: 'starter-product',
    baseCurrency: 'USD',
    fxSnapshot: {
      id: `fx-${version}`,
      asOf: '2026-09-12',
      rates: { USD: '1', EUR: '0.9' },
      sourceRefs: [`fx-source-${version}`],
    },
    skuRules: [{
      sku: 'SKU-1',
      requiredSpecifications: { grade: ['A', 'B'] },
      moq: 10,
      quantityTiers: [{ minQuantity: 1, unitPrice }, { minQuantity: 100, unitPrice: '0.80' }],
      unitCost: '0.40',
      incoterms: [{ code: 'FOB', flatFee: '1.00', perUnitFee: '0', leadTimeDays: 14 }],
      shippingRules: [{ destinationCountry: '*', incoterm: '*', flatFee: '2.00', perUnitFee: '0' }],
      taxRateBps: 0,
      taxBasis: 'goods_and_shipping',
      allowedPaymentTerms: ['TT30'],
      standardLeadTimeDays: 14,
      maxDiscountBps: 500,
      minMarginBps: 3000,
      validDays: 30,
    }],
    sourceRefs: [`product-source-${version}`],
  };
}

function inquiry(quantity = 10) {
  return {
    inquiryId: 'inquiry-route-1',
    inquiryVersion: '1',
    sku: 'SKU-1',
    specifications: { grade: 'A' },
    quantity,
    quoteCurrency: 'USD',
    incoterm: 'FOB',
    destinationCountry: 'DE',
    paymentTerm: 'TT30',
    quoteDate: '2026-09-12',
  };
}

const priorNodeEnv = process.env.NODE_ENV;
const priorLocalFallback = process.env.DISABLE_LOCAL_AUTH_FALLBACK;
process.env.NODE_ENV = 'test';
process.env.DISABLE_LOCAL_AUTH_FALLBACK = 'false';

const memory = new MemoryStore();
let clockTick = Date.parse('2026-09-12T08:00:00.000Z');
const service = new QuotationService(memory, () => new Date(clockTick += 1000));
const disabledCapabilities = new Map<string, Set<Starter198Capability>>();
let quoteDraftLimit = STARTER_198_DEFAULT_LIMITS.quoteDraftCountPerCycle;
const accessRepository = {
  async access(tenantId: string): Promise<Starter198AccessSnapshot> {
    if (tenantId === 'tenant-unprovisioned') throw new Starter198RepositoryError('starter_198_not_provisioned');
    if (tenantId === 'tenant-store-failure') throw new Starter198RepositoryError('starter_198_storage_unavailable');
    const disabled = disabledCapabilities.get(tenantId) ?? new Set<Starter198Capability>();
    return {
      recordId: `access-${tenantId}`,
      tenantId,
      productProfile: STARTER_198_PROFILE,
      profileVersion: STARTER_198_PROFILE_VERSION,
      entitlementSnapshotId: `entitlements-${tenantId}`,
      entitlements: STARTER_198_CAPABILITIES.map(capability => ({ capability, enabled: !disabled.has(capability) })),
      resourceLimits: { ...STARTER_198_DEFAULT_LIMITS, quoteDraftCountPerCycle: quoteDraftLimit },
      status: 'active',
      cycleStartedAt: '2026-09-12T00:00:00.000Z',
      cycleEndsAt: '2026-09-19T00:00:00.000Z',
      updatedAt: '2026-09-12T00:00:00.000Z',
    };
  },
};
const app = express();
app.use(express.json());
app.use('/api/overseas/starter-198/quotation', createStarter198QuotationRouter(
  service,
  accessRepository,
  () => new Date('2026-09-12T08:00:00.000Z'),
  createStarter198Repository(memory),
));
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('test server failed to listen');
const origin = `http://127.0.0.1:${address.port}/api/overseas/starter-198/quotation`;

async function request(
  pathname: string,
  method: string,
  authToken: string,
  body?: unknown,
  idempotency?: string,
  extraHeaders: Record<string, string> = {},
) {
  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
      ...(idempotency ? { 'Idempotency-Key': idempotency } : {}),
      ...extraHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null) as Record<string, any> | null;
  return { response, payload };
}

const adminA = token('tenant-a', 'admin');
const customerA = token('tenant-a', 'customer_service');
const socialA = token('tenant-a', 'social_operator');
const missingRoleA = token('tenant-a');
const adminB = token('tenant-b', 'admin');
const unprovisioned = token('tenant-unprovisioned', 'admin');
const unavailableAccess = token('tenant-store-failure', 'admin');
const disabledQuote = token('tenant-disabled-quote', 'admin');

try {
  disabledCapabilities.set('tenant-disabled-quote', new Set(['quotation.calculate']));
  assert.equal((await request('/estimate', 'POST', unprovisioned, {
    ruleSetKey: 'none', ruleSetVersion: 'v1', input: inquiry(),
  })).response.status, 403);
  assert.equal((await request('/estimate', 'POST', disabledQuote, {
    ruleSetKey: 'none', ruleSetVersion: 'v1', input: inquiry(),
  })).response.status, 403);
  assert.equal((await request('/estimate', 'POST', unavailableAccess, {
    ruleSetKey: 'none', ruleSetVersion: 'v1', input: inquiry(),
  })).response.status, 503);

  const createdA = await request('/rule-sets', 'POST', adminA, { ruleSet: ruleSet('v1', '1.00') }, 'rule-a-v1-0001');
  assert.equal(createdA.response.status, 201);
  assert.equal(createdA.payload?.capabilityBoundary, 'deterministic_quote_human_approval_no_provider_send');
  const repeatedRule = await request('/rule-sets', 'POST', adminA, { ruleSet: ruleSet('v1', '1.00') }, 'rule-a-v1-0001');
  assert.equal(repeatedRule.payload?.id, createdA.payload?.id);
  assert.equal(memory.collection('quote_rule_sets').length, 1);
  assert.equal((await request('/rule-sets', 'POST', adminA, { ruleSet: ruleSet('v1', '9.99') }, 'rule-a-v1-0001')).response.status, 409);

  assert.equal((await request('/rule-sets', 'POST', customerA, { ruleSet: ruleSet('nope', '1') }, 'customer-rule-01')).response.status, 403);
  assert.equal((await request('/estimate', 'POST', socialA, { ruleSetKey: 'starter-product', ruleSetVersion: 'v1', input: inquiry() })).response.status, 403);
  assert.equal((await request('/estimate', 'POST', missingRoleA, { ruleSetKey: 'starter-product', ruleSetVersion: 'v1', input: inquiry() })).response.status, 403);

  const createdB = await request('/rule-sets', 'POST', adminB, { ruleSet: ruleSet('v1', '7.00') }, 'rule-b-v1-0001');
  assert.equal(createdB.response.status, 201);
  const writesBeforeEstimate = memory.writes;
  const estimateA = await request(
    '/estimate?tenantId=tenant-b',
    'POST',
    customerA,
    { ruleSetKey: 'starter-product', ruleSetVersion: 'v1', input: inquiry() },
    undefined,
    { 'X-Tenant-Id': 'tenant-b' },
  );
  assert.equal(estimateA.response.status, 200);
  assert.equal(estimateA.payload?.calculation.goodsSubtotal.decimal, '10.00', 'query/header must not select the victim tenant rules');
  assert.equal(estimateA.payload?.externalEffect, 'none');
  assert.equal(estimateA.payload?.approvalAvailable, false);
  assert.equal(memory.writes, writesBeforeEstimate, 'estimate must be a zero-write calculation');

  const missingCount = memory.collection('quote_drafts').length;
  const missing = await request('/drafts', 'POST', customerA, {
    ruleSetKey: 'starter-product', ruleSetVersion: 'v1', input: { ...inquiry(), quoteCurrency: undefined },
  }, 'draft-missing-0001');
  assert.equal(missing.response.status, 422);
  assert.equal(missing.payload?.details.calculation, null);
  assert.equal(memory.collection('quote_drafts').length, missingCount, 'missing facts must create neither calculation record nor draft');

  const draftBody = { ruleSetKey: 'starter-product', ruleSetVersion: 'v1', input: inquiry() };
  const concurrent = await Promise.all([
    request('/drafts', 'POST', customerA, draftBody, 'draft-stable-0001'),
    request('/drafts', 'POST', customerA, draftBody, 'draft-stable-0001'),
  ]);
  assert.deepEqual(concurrent.map(item => item.response.status), [201, 201]);
  assert.equal(concurrent[0].payload?.id, concurrent[1].payload?.id);
  assert.equal(memory.collection('quote_drafts').filter(item => item.tenant_id === 'tenant-a').length, 1, 'concurrent retry must persist one draft');
  const draftV1 = concurrent[0].payload!;
  assert.equal(draftV1.status, 'draft_ready');
  assert.equal(draftV1.externalEffect, 'none');
  assert.equal(draftV1.approvalValid, false);
  assert.equal((await request('/drafts', 'POST', customerA, {
    ...draftBody, input: inquiry(11),
  }, 'draft-stable-0001')).response.status, 409, 'same idempotency key with changed payload must fail');

  assert.equal((await request(`/drafts/${draftV1.id}/approve`, 'POST', customerA, {}, 'approve-role-0001')).response.status, 403);
  assert.equal((await request(`/drafts/${draftV1.id}/approve`, 'POST', adminB, {}, 'approve-other-001')).response.status, 404);
  await assert.rejects(
    () => service.decideDraft(
      { tenantId: 'tenant-a', userId: 'tenant-a-user', role: 'admin' },
      draftV1.id,
      'stale-hash-check-1',
      'approved',
      '',
      '0'.repeat(64),
    ),
    (error: unknown) => error instanceof Error
      && (error as Error & { code?: string }).code === 'quote_draft_changed',
    'decision application must atomically reject a draft changed after workspace projection',
  );
  disabledCapabilities.set('tenant-a', new Set(['orchestrator.decision.resolve']));
  assert.equal((await request(`/drafts/${draftV1.id}/approve`, 'POST', adminA, {}, 'approve-disabled1')).response.status, 403);
  disabledCapabilities.delete('tenant-a');
  const approvedV1 = await request(`/drafts/${draftV1.id}/approve`, 'POST', adminA, { decisionNote: 'Reviewed against confirmed terms.' }, 'approve-v1-00001');
  assert.equal(approvedV1.response.status, 201);
  assert.equal(approvedV1.payload?.draft.status, 'approved');
  assert.equal(approvedV1.payload?.draft.approvalValid, true);
  assert.equal(approvedV1.payload?.evidence.currentlyValid, true);
  assert.equal(approvedV1.payload?.evidence.externalEffect, 'none');
  assert.equal(approvedV1.payload?.evidence.envelope.binding.inputHash, draftV1.inputHash);
  assert.equal(approvedV1.payload?.evidence.envelope.binding.ruleSetVersion, 'v1');
  assert.equal(approvedV1.payload?.evidence.envelope.binding.calculationHash, draftV1.calculationHash);
  const immutableApprovalSnapshot = JSON.stringify(memory.collection('quote_approval_evidence')[0]);
  const approvalRetry = await request(`/drafts/${draftV1.id}/approve`, 'POST', adminA, { decisionNote: 'Reviewed against confirmed terms.' }, 'approve-v1-00001');
  assert.equal(approvalRetry.payload?.evidence.id, approvedV1.payload?.evidence.id);
  assert.equal(memory.collection('quote_approval_evidence').length, 1);
  assert.equal((await request(`/drafts/${draftV1.id}/approve`, 'POST', adminA, { decisionNote: 'changed' }, 'approve-v1-00001')).response.status, 409);

  const foreignRead = await request(`/drafts/${draftV1.id}?tenantId=tenant-a`, 'GET', adminB, undefined, undefined, { 'X-Tenant-Id': 'tenant-a' });
  assert.equal(foreignRead.response.status, 404, 'record id plus forged tenant selectors must not cross tenants');
  const writesBeforeGet = memory.writes;
  assert.equal((await request(`/drafts/${draftV1.id}`, 'GET', customerA)).response.status, 200);
  assert.equal(memory.writes, writesBeforeGet, 'draft GET must be side-effect free');
  assert.equal((await request(`/drafts/${draftV1.id}`, 'GET', socialA)).response.status, 403, 'social operators must not read commercial quotes');
  assert.equal((await request(`/drafts/${draftV1.id}`, 'GET', missingRoleA)).response.status, 403, 'missing roles must fail closed on commercial reads');

  assert.equal((await request('/rule-sets', 'POST', adminA, { ruleSet: ruleSet('v2', '1.20') }, 'rule-a-v2-0001')).response.status, 201);
  const invalidatedAtActivation = await request(`/drafts/${draftV1.id}`, 'GET', customerA);
  assert.equal(invalidatedAtActivation.payload?.status, 'superseded', 'confirming a newer rule version must immediately invalidate the old approval');
  assert.equal(invalidatedAtActivation.payload?.approvalValid, false);
  assert.equal((await request('/estimate', 'POST', customerA, {
    ruleSetKey: 'starter-product', ruleSetVersion: 'v1', input: inquiry(),
  })).response.status, 409, 'superseded rules may be replayed only in the pure engine, never through executable APIs');
  const draftV2 = await request('/drafts', 'POST', customerA, {
    ruleSetKey: 'starter-product', ruleSetVersion: 'v2', input: inquiry(),
  }, 'draft-version-0002');
  assert.equal(draftV2.response.status, 201);
  assert.notEqual(draftV2.payload?.calculationHash, draftV1.calculationHash);
  const invalidatedByVersion = await request(`/drafts/${draftV1.id}`, 'GET', customerA);
  assert.equal(invalidatedByVersion.payload?.status, 'superseded');
  assert.equal(invalidatedByVersion.payload?.approvalValid, false);
  assert.equal(JSON.stringify(memory.collection('quote_approval_evidence')[0]), immutableApprovalSnapshot, 'approval evidence must remain immutable when validity changes');
  const invalidApprovalRetry = await request(`/drafts/${draftV1.id}/approve`, 'POST', adminA, { decisionNote: 'Reviewed against confirmed terms.' }, 'approve-v1-00001');
  assert.equal(invalidApprovalRetry.payload?.evidence.currentlyValid, false);
  assert.equal(invalidApprovalRetry.payload?.draft.status, 'superseded');

  const changedInput = await request('/drafts', 'POST', customerA, {
    ruleSetKey: 'starter-product', ruleSetVersion: 'v2', input: { ...inquiry(12), inquiryVersion: '2' },
  }, 'draft-input-0003');
  assert.equal(changedInput.response.status, 201);
  const invalidatedByInput = await request(`/drafts/${draftV2.payload?.id}`, 'GET', customerA);
  assert.equal(invalidatedByInput.payload?.status, 'superseded', 'changed inquiry facts must invalidate the old draft');
  assert.equal(invalidatedByInput.payload?.approvalValid, false);

  const approvedCurrent = await request(`/drafts/${changedInput.payload?.id}/approve`, 'POST', adminA, {}, 'approve-current-01');
  assert.equal(approvedCurrent.response.status, 201);
  const artifactHash = 'a'.repeat(64);
  disabledCapabilities.set('tenant-a', new Set(['publishing.evidence.submit']));
  assert.equal((await request(`/drafts/${changedInput.payload?.id}/external-send-evidence`, 'POST', customerA, {
    channel: 'email', artifactHash,
  }, 'evidence-disabled')).response.status, 403);
  disabledCapabilities.delete('tenant-a');
  const evidence = await request(`/drafts/${changedInput.payload?.id}/external-send-evidence`, 'POST', customerA, {
    channel: 'email', artifactHash, providerReference: 'manual-message-reference',
  }, 'evidence-current-1');
  assert.equal(evidence.response.status, 201);
  assert.equal(evidence.payload?.status, 'submitted_unverified');
  assert.equal(evidence.payload?.verified, false);
  assert.equal(evidence.payload?.providerInvoked, false);
  assert.equal(evidence.payload?.externalEffect, 'reported_by_user');
  assert.equal(evidence.payload?.draftStatusChanged, false);
  const evidenceRetry = await request(`/drafts/${changedInput.payload?.id}/external-send-evidence`, 'POST', customerA, {
    channel: 'email', artifactHash, providerReference: 'manual-message-reference',
  }, 'evidence-current-1');
  assert.equal(evidenceRetry.payload?.id, evidence.payload?.id);
  assert.equal(memory.collection('quote_external_send_evidence').length, 1);
  assert.equal((await request(`/drafts/${changedInput.payload?.id}/external-send-evidence`, 'POST', adminB, {
    channel: 'email', artifactHash,
  }, 'evidence-other-01')).response.status, 404);
  const stillOnlyApproved = await request(`/drafts/${changedInput.payload?.id}`, 'GET', customerA);
  assert.equal(stillOnlyApproved.payload?.status, 'approved', 'evidence submission must not claim or mark a send');

  const returnDraft = await request('/drafts', 'POST', customerA, {
    ruleSetKey: 'starter-product', ruleSetVersion: 'v2',
    input: { ...inquiry(), inquiryId: 'return-inquiry', inquiryVersion: '1' },
  }, 'draft-return-0001');
  assert.equal(returnDraft.response.status, 201);
  assert.equal((await request(`/drafts/${returnDraft.payload?.id}/decision`, 'POST', adminA, {
    decision: 'rejected',
  }, 'reject-no-note-1')).response.status, 400, 'a return decision must explain what needs to change');
  assert.equal((await request(`/drafts/${returnDraft.payload?.id}/decision`, 'POST', customerA, {
    decision: 'rejected', decisionNote: 'Need a different quantity.',
  }, 'reject-role-0001')).response.status, 403);
  const returned = await request(`/drafts/${returnDraft.payload?.id}/decision`, 'POST', adminA, {
    decision: 'rejected', decisionNote: 'Need a different quantity.',
  }, 'reject-final-001');
  assert.equal(returned.response.status, 201);
  assert.equal(returned.payload?.draft.status, 'returned');
  assert.equal(returned.payload?.draft.approvalValid, false);
  assert.equal(returned.payload?.evidence.decision, 'rejected');
  assert.equal(returned.payload?.evidence.currentlyEffective, true);
  assert.equal((await request(`/drafts/${returnDraft.payload?.id}/approve`, 'POST', adminA, {}, 'approve-returned')).response.status, 409, 'a returned draft cannot later be approved');
  const revisedAfterReturn = await request('/drafts', 'POST', customerA, {
    ruleSetKey: 'starter-product', ruleSetVersion: 'v2',
    input: { ...inquiry(11), inquiryId: 'return-inquiry', inquiryVersion: '2' },
  }, 'draft-return-0002');
  assert.equal(revisedAfterReturn.response.status, 201);
  assert.equal(revisedAfterReturn.payload?.status, 'draft_ready');
  assert.equal((await request(`/drafts/${returnDraft.payload?.id}`, 'GET', customerA)).payload?.status, 'superseded');

  const exceptionDraft = await request('/drafts', 'POST', customerA, {
    ruleSetKey: 'starter-product', ruleSetVersion: 'v2',
    input: { ...inquiry(), inquiryId: 'exception-inquiry', paymentTerm: 'NET90' },
  }, 'draft-exception-01');
  assert.equal(exceptionDraft.response.status, 201);
  assert.equal(exceptionDraft.payload?.status, 'exception_pending');
  assert.ok(exceptionDraft.payload?.exceptionRequestId);
  assert.equal(memory.collection('quote_exception_requests').length, 1);
  assert.equal((await request(`/drafts/${exceptionDraft.payload?.id}/approve`, 'POST', adminA, {}, 'approve-exception')).response.status, 409);

  assert.equal((await request(`/drafts/${changedInput.payload?.id}/send`, 'POST', adminA, {}, 'send-denied-0001')).response.status, 404);
  assert.equal(memory.collection('quote_send_requests').length, 0);

  const expiredDraft = await request('/drafts', 'POST', customerA, {
    ruleSetKey: 'starter-product', ruleSetVersion: 'v2',
    input: { ...inquiry(), inquiryId: 'expired-inquiry', quoteDate: '2020-01-01' },
  }, 'draft-expired-001');
  assert.equal(expiredDraft.response.status, 201);
  assert.equal((await request(`/drafts/${expiredDraft.payload?.id}/approve`, 'POST', adminA, {}, 'approve-expired-1')).response.status, 409);
  assert.equal((await request(`/drafts/${expiredDraft.payload?.id}`, 'GET', customerA)).payload?.status, 'expired');

  const override = await request('/drafts', 'POST', customerA, {
    tenantId: 'tenant-b', ruleSetKey: 'starter-product', ruleSetVersion: 'v2', input: inquiry(),
  }, 'draft-override-01');
  assert.equal(override.response.status, 400);

  quoteDraftLimit = memory.collection('quote_drafts').filter(item => item.tenant_id === 'tenant-a').length;
  const writesBeforeQuota = memory.writes;
  const overQuota = await request('/drafts', 'POST', customerA, {
    ruleSetKey: 'starter-product', ruleSetVersion: 'v2',
    input: { ...inquiry(), inquiryId: 'over-quota-inquiry', inquiryVersion: '1' },
  }, 'draft-over-quota-1');
  assert.equal(overQuota.response.status, 409);
  assert.equal(overQuota.payload?.error, 'starter_198_quote_draft_quota_exceeded');
  assert.equal(memory.writes, writesBeforeQuota, 'quota denial must happen before any quote write');

  console.log('starter198 quotation routes passed: roles, tenant isolation, idempotency, immutable approval, invalidation, unverified manual evidence, and no provider send surface');
} finally {
  process.env.NODE_ENV = priorNodeEnv;
  if (priorLocalFallback === undefined) delete process.env.DISABLE_LOCAL_AUTH_FALLBACK;
  else process.env.DISABLE_LOCAL_AUTH_FALLBACK = priorLocalFallback;
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
