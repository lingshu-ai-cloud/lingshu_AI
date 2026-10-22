import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';
import { socialRequestHash } from '../starter198/socialContentValidation.js';
import { approveLinkedInCompanyCollection } from './linkedinCompanyCollectionApproval.js';
import { quoteLinkedInCompanyCollection, type LinkedInCompanyCostEvidence } from './linkedinCompanyCollectionQuote.js';

const now = Date.parse('2026-10-23T08:00:00Z');
const companyUrl = 'https://www.linkedin.com/company/factory/';
const scope = { tenantId: 'tenant-a', runId: 'run-a', companyUrl, limit: 3, dateFrom: '', dateTo: '' };

async function fixture() {
  const tables = new Map<string, Record_[]>();
  const add = (name: string, row: Record_) => tables.set(name, [...(tables.get(name) ?? []), structuredClone(row)]);
  const payload = { approval: { status: 'approved', scopeVersion: 1 },
    discoveryBrief: { budgetLimitCny: 5, competitorAccounts: [companyUrl],
      modePolicies: { account: { enabled: true } } } };
  add('users', { id: 'owner', tenantId: 'tenant-a', role: 'social_operator', active: true });
  add('social_discovery_scopes', { id: 'scope-a', tenant_id: 'tenant-a', status: 'active', version: 1, payload });
  add('competitor_accounts', { id: 'account-a', tenantId: 'tenant-a', platform: 'linkedin', accountUrl: companyUrl });
  const store: DataStore = {
    async getById<T>(name: string, id: string) { return structuredClone(tables.get(name)?.find(row => row.id === id) ?? null) as T | null; },
    async create<T>(name: string, data: Record<string, unknown>) {
      if (tables.get(name)?.some(row => row.id === data.id)) return null;
      add(name, data as Record_);
      return structuredClone(data) as T;
    },
    async list<T>(name: string, query: ListQuery = {}) {
      const rows = (tables.get(name) ?? []).filter(row => Object.entries(query.where ?? {})
        .every(([key, value]) => row[key] === value));
      const page = query.page ?? 1, perPage = query.perPage ?? 30;
      return { items: structuredClone(rows.slice((page - 1) * perPage, page * perPage)) as T[],
        totalItems: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / perPage)), page, perPage };
    },
    async update(name: string, id: string, data: Record<string, unknown>) {
      const row = tables.get(name)?.find(item => item.id === id);
      if (!row) return false;
      Object.assign(row, structuredClone(data));
      return true;
    },
    async delete() { return false; },
  };
  const approval = await approveLinkedInCompanyCollection({ store, scope, discoveryScopeId: 'scope-a',
    discoveryScopeVersion: 1, discoveryScopeHash: socialRequestHash(payload),
    actorId: 'logical_scrapers/linkedin-company-posts-scraper', maximumCny: 2,
    approvedBy: 'owner', expiresAt: new Date(now + 86_400_000).toISOString(), now: () => now });
  const evidence: LinkedInCompanyCostEvidence = {
    actorId: approval.actorId, accountRef: 'server-owned-account', tokenFingerprint: 'a'.repeat(64),
    actorMaxTotalChargeUsd: 0.1, fxCnyPerUsdUpper: 8, fxEvidenceRef: 'verified-fx',
    nonActorMaximumCny: 0.2, nonActorEvidenceRef: 'verified-dataset-storage-transfer',
    pricingEvidenceRef: 'verified-account-pricing', checkedAt: new Date(now - 1000).toISOString(),
    validUntil: new Date(now + 2 * 86_400_000).toISOString(),
  };
  let checks = 0;
  const ports = {
    readAccountBinding: async () => ({ accountRef: evidence.accountRef, tokenFingerprint: evidence.tokenFingerprint }),
    readCostEvidence: async () => structuredClone(evidence),
    verifyCostEvidence: async () => { checks++; return true; },
  };
  return { store, tables, approval, evidence, ports, checks: () => checks };
}

test('exact approved LinkedIn run quotes Actor and non-Actor maximum in CNY without a paid permit', async () => {
  const f = await fixture();
  const quote = await quoteLinkedInCompanyCollection({ store: f.store, scope, approval: f.approval,
    ports: f.ports, now: () => now });
  assert.equal(quote.maxTotalChargeUsd, 0.1);
  assert.equal(quote.actorCnyMicros, 800_000);
  assert.equal(quote.nonActorCnyMicros, 200_000);
  assert.equal(quote.reservedCnyMicros, 1_000_000);
  assert.equal(quote.approvalRecordHash, f.approval.recordHash);
  assert.equal(quote.validUntil, f.approval.expiresAt);
  assert.equal(f.checks(), 1);
  assert.equal((await f.store.list('social_linkedin_company_collection_approvals')).totalItems, 1);
});

test('missing or mismatched account evidence, incomplete costs and over-budget quotes fail closed', async () => {
  const f = await fixture();
  const request = { store: f.store, scope, approval: f.approval, ports: f.ports, now: () => now };
  await assert.rejects(quoteLinkedInCompanyCollection({ ...request,
    ports: { ...f.ports, readCostEvidence: async () => null } }), /evidence_unverified/);
  await assert.rejects(quoteLinkedInCompanyCollection({ ...request,
    ports: { ...f.ports, readCostEvidence: async () => ({ ...f.evidence, tokenFingerprint: 'b'.repeat(64) }) } }), /evidence_unverified/);
  await assert.rejects(quoteLinkedInCompanyCollection({ ...request,
    ports: { ...f.ports, readCostEvidence: async () => ({ ...f.evidence, nonActorMaximumCny: 0 }) } }), /evidence_unverified/);
  await assert.rejects(quoteLinkedInCompanyCollection({ ...request,
    ports: { ...f.ports, verifyCostEvidence: async () => false } }), /evidence_unverified/);
  await assert.rejects(quoteLinkedInCompanyCollection({ ...request,
    ports: { ...f.ports, readCostEvidence: async () => ({ ...f.evidence, actorMaxTotalChargeUsd: 0.3 }) } }), /budget_exceeded/);
});

test('changed source or approval cannot be quoted', async () => {
  const f = await fixture();
  await assert.rejects(quoteLinkedInCompanyCollection({ store: f.store,
    scope: { ...scope, tenantId: 'tenant-b' }, approval: f.approval, ports: f.ports, now: () => now }),
  /changed_or_expired/);
  const row = f.tables.get('social_discovery_scopes')![0]!;
  row.status = 'retired';
  await assert.rejects(quoteLinkedInCompanyCollection({ store: f.store, scope,
    approval: f.approval, ports: f.ports, now: () => now }), /discovery_scope_changed/);
});

test('source revoked while cost evidence is read cannot produce a quote', async () => {
  const f = await fixture();
  await assert.rejects(quoteLinkedInCompanyCollection({ store: f.store, scope,
    approval: f.approval, now: () => now, ports: { ...f.ports,
      readCostEvidence: async () => {
        f.tables.get('social_discovery_scopes')![0]!.status = 'retired';
        return structuredClone(f.evidence);
      },
    } }), /discovery_scope_changed/);
});
