import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';
import { socialRequestHash } from '../starter198/socialContentValidation.js';
import { frozenLinkedInCompanyActorInput } from '../routes/linkedinCompanyPostPaidCollection.js';
import { runLinkedInCompanyPaidCollection } from '../routes/linkedinCompanyPostPaidCollection.js';
import { apifyTokenFingerprint, APIFY_PREPAID_TOKEN_FINGERPRINT_SCHEME } from './apifyTokenFingerprint.js';
import { approveLinkedInCompanyCollection } from './linkedinCompanyCollectionApproval.js';
import { quoteLinkedInCompanyCollection } from './linkedinCompanyCollectionQuote.js';
import { reserveLinkedInCompanyCollection } from './linkedinCompanyCollectionPermit.js';

const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const at = Date.parse('2026-10-23T08:00:00Z');
const scope = { tenantId: 'tenant-a', runId: 'run-a', companyUrl: 'https://www.linkedin.com/company/factory/',
  limit: 3, dateFrom: '', dateTo: '' };

async function fixture(t: { after: (cleanup: () => void) => void }) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'linkedin-permit-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rows = new Map<string, Record_[]>();
  const add = (name: string, row: Record_) => rows.set(name, [...(rows.get(name) ?? []), structuredClone(row)]);
  const payload = { approval: { status: 'approved', scopeVersion: 1 }, discoveryBrief: {
    budgetLimitCny: 5, competitorAccounts: [scope.companyUrl], modePolicies: { account: { enabled: true } } } };
  add('users', { id: 'owner', tenantId: scope.tenantId, role: 'social_operator', active: true });
  add('social_discovery_scopes', { id: 'scope-a', tenant_id: scope.tenantId,
    status: 'active', version: 1, payload });
  add('competitor_accounts', { id: 'account-a', tenantId: scope.tenantId,
    platform: 'linkedin', accountUrl: scope.companyUrl });
  const store: DataStore = {
    async getById<T>(name: string, id: string) {
      return structuredClone(rows.get(name)?.find(row => row.id === id) ?? null) as T | null;
    },
    async create<T>(name: string, data: Record<string, unknown>) {
      if (rows.get(name)?.some(row => row.id === data.id)) return null;
      add(name, data as Record_); return structuredClone(data) as T;
    },
    async list<T>(name: string, query: ListQuery = {}) {
      const matched = (rows.get(name) ?? []).filter(row => Object.entries(query.where ?? {})
        .every(([key, value]) => row[key] === value));
      const perPage = query.perPage ?? 30;
      return { items: structuredClone(matched.slice(0, perPage)) as T[], totalItems: matched.length,
        totalPages: 1, page: 1, perPage };
    },
    async update() { return false; }, async delete() { return false; },
  };
  const approval = await approveLinkedInCompanyCollection({ store, scope,
    discoveryScopeId: 'scope-a', discoveryScopeVersion: 1,
    discoveryScopeHash: socialRequestHash(payload),
    actorId: 'logical_scrapers/linkedin-company-posts-scraper', maximumCny: 2,
    approvedBy: 'owner', expiresAt: new Date(at + 86_400_000).toISOString(), now: () => at });
  const tokenFingerprint = apifyTokenFingerprint('test-token', APIFY_PREPAID_TOKEN_FINGERPRINT_SCHEME);
  const ports = { readAccountBinding: async () => ({ accountRef: 'account', tokenFingerprint }),
      readCostEvidence: async () => ({ actorId: approval.actorId, accountRef: 'account', tokenFingerprint,
        actorMaxTotalChargeUsd: 0.1, fxCnyPerUsdUpper: 8, fxEvidenceRef: 'fx-proof',
        nonActorMaximumCny: 0.2, nonActorEvidenceRef: 'dataset-proof',
        pricingEvidenceRef: 'tariff-proof', checkedAt: new Date(at - 1000).toISOString(),
        validUntil: new Date(at + 86_400_000).toISOString() }),
      verifyCostEvidence: async () => true };
  const quote = await quoteLinkedInCompanyCollection({ store, scope, approval, now: () => at, ports });
  const reserve = () => reserveLinkedInCompanyCollection({ root, store, approval, ports, now: () => at });
  const request = { actorId: quote.actorId, maxTotalChargeUsd: quote.maxTotalChargeUsd,
    requestHash: sha({ actorId: quote.actorId, actorInput: frozenLinkedInCompanyActorInput(scope),
      maxTotalChargeUsd: quote.maxTotalChargeUsd, restartOnError: false }) };
  return { root, store, approval, quote, ports, reserve, request };
}

test('one durable LinkedIn POST claim survives permit recreation and cannot replay unknown results', async t => {
  const f = await fixture(t);
  const first = await f.reserve(), second = await f.reserve();
  const outcomes = await Promise.allSettled([first.beforeSubmit(f.request), second.beforeSubmit(f.request)]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(item => item.status === 'rejected').length, 1);
  assert.deepEqual(await (await f.reserve()).inspect(f.request), { status: 'submitted_unknown' });
  await assert.rejects((await f.reserve()).beforeSubmit(f.request), /submission_unknown_no_replay/);
  await assert.rejects(first.beforeDatasetRead({ runId: 'provider-run', datasetId: 'dataset', maxItems: 3 }),
    /dataset_read_not_authorized/);
});

test('original HTTP receipts bind run settlement and dataset GET has a separate one-time claim', async t => {
  const f = await fixture(t), permit = await f.reserve();
  await permit.beforeSubmit(f.request);
  const runId = 'provider-run', datasetId = 'dataset-a';
  const submitRef = await permit.persistRawReceipt({ phase: 'actor_submit', operationId: f.quote.operationId,
    actorId: f.quote.actorId, requestHash: f.request.requestHash, httpStatus: 200,
    responseBody: JSON.stringify({ data: { id: runId, defaultDatasetId: datasetId } }) });
  await assert.rejects(permit.recordRun({ runId: 'other', datasetId,
    maxTotalChargeUsd: 0.1, rawReceiptRef: submitRef }), /run_receipt_invalid/);
  await permit.recordRun({ runId, datasetId, maxTotalChargeUsd: 0.1, rawReceiptRef: submitRef });
  const terminalRef = await permit.persistRawReceipt({ phase: 'actor_poll', operationId: f.quote.operationId,
    actorId: f.quote.actorId, requestHash: f.request.requestHash, runId, datasetId,
    httpStatus: 200, responseBody: JSON.stringify({ data: { id: runId,
      status: 'SUCCEEDED', usageTotalUsd: 0.03 } }) });
  await permit.recordTerminal({ runId, status: 'SUCCEEDED', usageTotalUsd: 0.03, rawReceiptRef: terminalRef });
  assert.deepEqual(await (await f.reserve()).inspect(f.request),
    { status: 'completed', runId, datasetId, usageTotalUsd: 0.03 });
  await permit.beforeDatasetRead({ runId, datasetId, maxItems: 3 });
  const datasetRef = await permit.persistRawReceipt({ phase: 'dataset_read', operationId: f.quote.operationId,
    actorId: f.quote.actorId, requestHash: f.request.requestHash, runId, datasetId,
    httpStatus: 200, responseBody: '[{"id":"post-1"}]' });
  assert.match(datasetRef, /^linkedin-company-receipt:/);
  await assert.rejects((await f.reserve()).beforeDatasetRead({ runId, datasetId, maxItems: 3 }),
    /dataset_read_not_authorized/);
});

test('changed quote and revoked source cannot create or consume a new claim', async t => {
  const f = await fixture(t);
  await assert.rejects(reserveLinkedInCompanyCollection({ root: f.root, store: f.store,
    approval: f.approval, ports: { ...f.ports, verifyCostEvidence: async () => false }, now: () => at }),
  /quote_evidence_unverified/);
  const permit = await f.reserve();
  const revokedId = sha(['linkedin-company-collection-revocation.v1', f.approval.approvalId]).slice(0, 15);
  await f.store.create('social_linkedin_company_collection_revocations', { id: revokedId });
  await assert.rejects(permit.beforeSubmit(f.request), /revoked/);
  await assert.rejects(f.reserve(), /revoked/);
});

test('cost evidence changing after reservation prevents a paid submission', async t => {
  const f = await fixture(t), permit = await f.reserve();
  const original = f.ports.readCostEvidence;
  f.ports.readCostEvidence = async () => ({ ...(await original()),
    nonActorMaximumCny: 0.3 });
  await assert.rejects(permit.beforeSubmit(f.request), /quote_changed/);
  await assert.rejects(permit.inspect(f.request), /quote_changed/);
});

test('ledger permit drives one mocked Actor POST and receipt-backed dataset read without replay', async t => {
  const f = await fixture(t), previousFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (request, init) => {
    const url = new URL(String(request)); calls.push(`${init?.method || 'GET'} ${url.pathname}`);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-token');
    if (init?.method === 'POST') return new Response(JSON.stringify({ data: {
      id: 'provider-run', defaultDatasetId: 'dataset-a' } }), { status: 200 });
    if (url.pathname.endsWith('/actor-runs/provider-run')) return new Response(JSON.stringify({ data: {
      id: 'provider-run', defaultDatasetId: 'dataset-a', status: 'SUCCEEDED', usageTotalUsd: 0.03,
      options: { maxTotalChargeUsd: 0.1, restartOnError: false } } }), { status: 200 });
    if (url.pathname.endsWith('/datasets/dataset-a/items')) return new Response(JSON.stringify([{
      postUrl: 'https://www.linkedin.com/posts/factory_activity-123', text: 'Factory #B2B',
      images: ['https://media.example.test/photo.jpg'] }]), { status: 200 });
    throw Error('unexpected_mock_request');
  };
  try {
    const result = await runLinkedInCompanyPaidCollection({ scope, actorId: f.quote.actorId,
      token: 'test-token', permit: await f.reserve(), settlementDelayMs: 0 });
    assert.equal(result.images.length, 1);
    assert.equal(calls.filter(call => call.startsWith('POST')).length, 1);
    await assert.rejects(runLinkedInCompanyPaidCollection({ scope, actorId: f.quote.actorId,
      token: 'test-token', permit: await f.reserve(), settlementDelayMs: 0 }), /dataset_read_not_authorized/);
    assert.equal(calls.filter(call => call.startsWith('POST')).length, 1);
  } finally { globalThis.fetch = previousFetch; }
});
