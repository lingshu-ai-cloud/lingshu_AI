import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';
import { socialRequestHash } from '../starter198/socialContentValidation.js';
import type { LinkedInCompanyCollectionScope } from '../routes/linkedinCompanyPostPaidCollection.js';
import { approveLinkedInCompanyCollection, createLinkedInCompanyApprovalAssertion, readCurrentLinkedInCompanyCollectionApproval,
  revokeLinkedInCompanyCollection, LINKEDIN_COMPANY_COLLECTION_APPROVALS,
  LINKEDIN_COMPANY_COLLECTION_REVOCATIONS } from './linkedinCompanyCollectionApproval.js';

const now = Date.parse('2026-10-23T08:00:00Z');
const companyUrl = 'https://www.linkedin.com/company/factory/';
const scope: LinkedInCompanyCollectionScope = { tenantId: 'tenant-a', runId: 'run-a',
  companyUrl, limit: 3, dateFrom: '', dateTo: '' };

function fixture() {
  const tables = new Map<string, Record_[]>();
  const push = (collection: string, row: Record_) => tables.set(collection,
    [...(tables.get(collection) ?? []), structuredClone(row)]);
  const payload = { approval: { status: 'approved', scopeVersion: 1 },
    discoveryBrief: { budgetLimitCny: 5, competitorAccounts: [companyUrl],
      modePolicies: { account: { enabled: true } } } };
  push('users', { id: 'owner', tenantId: 'tenant-a', role: 'social_operator', active: true });
  push('social_discovery_scopes', { id: 'scope-a', tenant_id: 'tenant-a', status: 'active',
    version: 1, payload });
  push('competitor_accounts', { id: 'account-a', tenantId: 'tenant-a',
    platform: 'linkedin', accountUrl: companyUrl });
  const store: DataStore = {
    async getById<T>(collection: string, id: string) { return structuredClone(tables.get(collection)?.find(x => x.id === id)
      ?? null) as T | null; },
    async create<T>(collection: string, data: Record<string, unknown>) {
      const id = String(data.id);
      if (tables.get(collection)?.some(x => x.id === id)) return null;
      const row = structuredClone(data) as Record_;
      push(collection, row);
      return row as T;
    },
    async list<T>(collection: string, query: ListQuery = {}) {
      const all = (tables.get(collection) ?? []).filter(x => Object.entries(query.where ?? {})
        .every(([key, value]) => x[key] === value));
      const page = query.page ?? 1, perPage = query.perPage ?? 30;
      return { items: structuredClone(all.slice((page - 1) * perPage, page * perPage)) as T[],
        totalItems: all.length, totalPages: Math.max(1, Math.ceil(all.length / perPage)), page, perPage };
    },
    async update(collection, id, data) {
      const row = tables.get(collection)?.find(x => x.id === id);
      if (!row) return false;
      Object.assign(row, structuredClone(data));
      return true;
    },
    async delete() { return false; },
  };
  const request = { store, scope, discoveryScopeId: 'scope-a', discoveryScopeVersion: 1,
    discoveryScopeHash: socialRequestHash(payload), actorId: 'logical_scrapers/linkedin-company-posts-scraper',
    maximumCny: 2, approvedBy: 'owner', expiresAt: new Date(now + 86_400_000).toISOString(),
    now: () => now };
  const read = () => readCurrentLinkedInCompanyCollectionApproval({ store, scope,
    discoveryScopeId: 'scope-a', discoveryScopeVersion: 1,
    discoveryScopeHash: socialRequestHash(payload), now });
  return { store, tables, request, read };
}

test('approval persists exact scope and concurrent duplicate approvals have one winner', async () => {
  const f = fixture();
  const results = await Promise.allSettled([approveLinkedInCompanyCollection(f.request),
    approveLinkedInCompanyCollection(f.request)]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal((await f.store.list(LINKEDIN_COMPANY_COLLECTION_APPROVALS)).totalItems, 1);
  const approved = await f.read();
  assert.equal(approved.maximumCny, 2);
  assert.equal(approved.companyUrl, companyUrl);
  assert.equal(approved.actorInputSha256.length, 64);
  assert.equal((await f.store.list(LINKEDIN_COMPANY_COLLECTION_REVOCATIONS)).totalItems, 0);
});

test('approval fails closed on altered discovery scope, removed account, expiry and revocation', async () => {
  const f = fixture();
  const approved = await approveLinkedInCompanyCollection(f.request);
  await assert.rejects(readCurrentLinkedInCompanyCollectionApproval({ store: f.store,
    scope: { ...scope, limit: 4 }, discoveryScopeId: 'scope-a', discoveryScopeVersion: 1,
    discoveryScopeHash: f.request.discoveryScopeHash, now }), /changed_or_expired/);
  await assert.rejects(readCurrentLinkedInCompanyCollectionApproval({ store: f.store,
    scope, discoveryScopeId: 'scope-a', discoveryScopeVersion: 1,
    discoveryScopeHash: f.request.discoveryScopeHash, now: now + 86_400_001 }), /changed_or_expired/);
  await f.store.update('social_discovery_scopes', 'scope-a', { status: 'retired' });
  await assert.rejects(f.read(), /discovery_scope_changed/);
  await f.store.update('social_discovery_scopes', 'scope-a', { status: 'active' });
  await f.store.update('competitor_accounts', 'account-a', { tenantId: 'tenant-b' });
  await assert.rejects(f.read(), /account_library_changed/);
  await f.store.update('competitor_accounts', 'account-a', { tenantId: 'tenant-a' });
  await revokeLinkedInCompanyCollection({ store: f.store, approval: approved,
    actorUserId: 'owner', reason: 'withdrawn', now: () => now + 1 });
  await assert.rejects(f.read(), /revoked/);
  assert.equal((await f.store.list(LINKEDIN_COMPANY_COLLECTION_REVOCATIONS)).totalItems, 1);
});

test('cross-tenant actors, unapproved scope and over-budget approval cannot be stored', async () => {
  const f = fixture();
  await f.store.update('users', 'owner', { tenantId: 'tenant-b' });
  await assert.rejects(approveLinkedInCompanyCollection(f.request), /actor_invalid/);
  await f.store.update('users', 'owner', { tenantId: 'tenant-a' });
  await assert.rejects(approveLinkedInCompanyCollection({ ...f.request, maximumCny: 6 }),
    /discovery_scope_changed/);
  const scopeRow = await f.store.getById<Record_>('social_discovery_scopes', 'scope-a');
  const payload = structuredClone(scopeRow!.payload as Record<string, unknown>);
  payload.approval = { status: 'draft', scopeVersion: 1 };
  await f.store.update('social_discovery_scopes', 'scope-a', { payload });
  await assert.rejects(approveLinkedInCompanyCollection({ ...f.request,
    discoveryScopeHash: socialRequestHash(payload) }), /discovery_scope_changed/);
  assert.equal((await f.store.list(LINKEDIN_COMPANY_COLLECTION_APPROVALS)).totalItems, 0);
});

test('store-backed permit assertion rechecks scope and revocation at use time', async () => {
  const f = fixture();
  const approved = await approveLinkedInCompanyCollection(f.request);
  const assertApproved = createLinkedInCompanyApprovalAssertion({ store: f.store,
    approval: approved, now: () => now + 1 });
  await assertApproved(scope, approved.actorInputSha256);
  await assert.rejects(assertApproved({ ...scope, limit: 4 }, approved.actorInputSha256),
    /permit_scope_changed/);
  await assert.rejects(assertApproved(scope, '0'.repeat(64)), /permit_scope_changed/);
  await revokeLinkedInCompanyCollection({ store: f.store, approval: approved,
    actorUserId: 'owner', reason: 'withdrawn', now: () => now + 2 });
  await assert.rejects(assertApproved(scope, approved.actorInputSha256), /revoked/);
});
