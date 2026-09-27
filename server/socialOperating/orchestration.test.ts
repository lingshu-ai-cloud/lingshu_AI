import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { createSocialOperatingOrchestrationService, weeklyAuthorityFromResolution } from './orchestration.js';
import { createWeeklyOperatingPackageService } from '../socialPrograms/weeklyOperatingPackages.js';

function memoryStore(seed: Record<string, Record_[]>): DataStore & { rows: Map<string, Record_[]> } {
  const rows = new Map(Object.entries(structuredClone(seed)));
  let sequence = 0;
  return {
    rows,
    async getById<T>(collection: string, id: string) { return structuredClone(rows.get(collection)?.find(item => item.id === id) ?? null) as T | null; },
    async create<T>(collection: string, data: Record<string, unknown>) {
      const row = { id: `row-${++sequence}`, ...structuredClone(data) } as Record_;
      rows.set(collection, [...(rows.get(collection) ?? []), row]);
      return structuredClone(row) as T;
    },
    async update(collection: string, id: string, data: Record<string, unknown>) {
      const list = rows.get(collection) ?? []; const index = list.findIndex(item => item.id === id);
      if (index < 0) return false; list[index] = { ...list[index], ...structuredClone(data) }; return true;
    },
    async delete(collection: string, id: string) {
      const list = rows.get(collection) ?? []; const next = list.filter(item => item.id !== id); rows.set(collection, next); return next.length !== list.length;
    },
    async list<T>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
      let items = (rows.get(collection) ?? []).filter(item => Object.entries(query.where ?? {}).every(([key, value]) => item[key] === value));
      if (query.sort) { const desc = query.sort.startsWith('-'); const key = desc ? query.sort.slice(1) : query.sort; items = [...items].sort((a, b) => { const av = a[key]; const bv = b[key]; const delta = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? '')); return delta * (desc ? -1 : 1); }); }
      const page = query.page ?? 1; const perPage = query.perPage ?? 30; const start = (page - 1) * perPage;
      return { items: structuredClone(items.slice(start, start + perPage)) as T[], totalItems: items.length, totalPages: Math.max(1, Math.ceil(items.length / perPage)), page, perPage };
    },
  };
}

const now = '2026-09-26T00:00:00.000Z';
const program = {
  programId: 'program-a', brandName: 'Factory', businessLine: null, market: 'US', targetAudience: 'brand buyer',
  candidatePlatforms: ['tiktok'], route: 'cold_start', stage: 'ready_for_week', readiness: {}, enterpriseProfileRef: null,
  productMarketingProfileRefs: [], activeMonthlyPlanRef: null, activeWeeklyPlanRef: null, activeWeeklyOperatingPackageRef: null,
  version: 1, status: 'active', createdAt: now, updatedAt: now,
};
const account = {
  accountId: 'account-a', programId: 'program-a', platform: 'tiktok', displayName: 'TikTok', handle: '@factory', businessRole: 'proof',
  audiencePromise: 'facts', contentPromise: 'evidence', status: 'active', connectionId: 'connection-a', connectionCapabilities: ['publish'],
  playbookRef: { type: 'account_playbook', id: 'playbook-a', version: 1 },
  conversionRoute: { routeId: 'route-a', entryType: 'form', entryRef: 'https://example.test/form', callToAction: 'Submit', qualificationFields: [], handoffTarget: 'sales-a', verifiedAt: now },
  version: 2, createdAt: now, updatedAt: now,
};

test('formal orchestration reads server authorities, persists decisions, and hydrates weekly packages only by snapshot ref', async () => {
  const store = memoryStore({
    social_programs: [{ id: 'program-row', tenant_id: 'tenant-a', program_id: 'program-a', payload: program } as Record_],
    tenant_profiles: [{ id: 'profile-a', tenant_id: 'tenant-a', version: 4, profile: { company: { description: 'Verified factory', mainMarkets: 'US', primaryLanguages: 'en' }, products: { items: [{ name: 'Serum', images: [{ id: 1 }, { id: 2 }] }, { name: 'Lotion', images: [{ id: 3 }] }], highlights: 'Small batch sampling' }, brand: { usp: 'Documented QC' }, customers: { targetProfiles: 'brand buyer' } } } as Record_],
    social_owned_accounts: [{ id: 'account-row', tenant_id: 'tenant-a', program_id: 'program-a', account_id: 'account-a', payload: account } as Record_],
    digital_employee_configs: [{ id: 'config-a', tenant_id: 'tenant-a', status: 'active', activated_at: now, config_version: 3, config: { autonomyMode: 'managed', approvalOwner: 'sales-a', enabledWorkflows: ['product_content', 'content_publish', 'customer_segmentation'], publishingTargets: [{ platform: 'tiktok', accountId: 'account-a', accountLabel: 'TikTok' }] } } as Record_],
    studio_production_defaults: [{ id: 'studio-a', tenant_id: 'tenant-a', version: 2, payload: { presenters: [{ id: 'p', authorized: true }] } } as Record_],
  });
  const service = createSocialOperatingOrchestrationService(store, () => now);
  const constraints = await service.saveConstraints('tenant-a', 'owner-a', 'program-a', {
    expectedVersion: 0, weeklyBudgetCny: 500, costPerOriginalCny: 50, costPerAdaptationCny: 20,
    materialUnitsPerOriginal: 1, productionItemsPerDay: 5, interactionItemsPerWeek: 20, salesLeadsPerWeek: 10,
    expectedInteractionsPerPublication: 2, expectedLeadsPerPublication: 1, accountWeeklyPublicationCapacity: { 'account-a': 5 },
    ready: true, capacityPlan: { publicationQuota: 999 },
  });
  assert.equal(constraints.version, 1);
  assert.equal('ready' in constraints, false, 'raw constraint writes cannot smuggle a readiness result');

  const resolution = await service.resolve('tenant-a', 'owner-a', 'program-a', {
    weekStart: '2026-09-28', desiredOriginalContents: 2, desiredAdaptations: 2, requestedReferenceMode: 'ordinary_inspiration', expectedSnapshotVersion: 0,
  });
  assert.equal(resolution.goal.status, 'ready');
  assert.equal(resolution.capacityPlan.publicationQuota, 4);
  assert.equal(resolution.automationPolicy.mode, 'managed');
  assert.equal(resolution.referenceMode.productMode, 'ordinary_inspiration');
  assert.deepEqual(resolution.snapshot.capabilityStates, { 'studio.production': 'available', 'publishing.calendar': 'available', 'customer.attribution': 'available' });
  assert.equal(store.rows.get('social_operating_decisions')?.length, 4, 'goal plus three resolver decisions are append-only');
  assert.equal(store.rows.get('social_operating_authority_snapshots')?.length, 1);

  const weekly = createWeeklyOperatingPackageService(store);
  const authority = weeklyAuthorityFromResolution(resolution);
  const pkg = await weekly.create('tenant-a', 'owner-a', 'program-a', {
    ...authority, weekStart: '2026-09-28', successCriteria: ['qualified inquiry'],
    accountPlans: [{ accountId: 'account-a', publicationCount: 50 }], originalContentTarget: 50, weeklyBudgetCny: 999_999,
  });
  assert.deepEqual(pkg.operatingDecisionSnapshotRef, authority.operatingDecisionSnapshotRef);
  assert.deepEqual(pkg.capacityPlanRef, resolution.snapshot.capacityPlanRef);
  assert.equal(pkg.socialContentPackage.publicationTaskTarget, 4);
  assert.equal(pkg.socialContentPackage.originalContentTarget, 2);
  assert.equal(pkg.socialContentPackage.weeklyBudgetCny, 500);
  assert.equal(pkg.enterpriseProfileRef?.version, 4);

  await assert.rejects(weekly.create('tenant-a', 'owner-a', 'program-a', {
    weekStart: '2026-10-05', objective: 'forged', successCriteria: ['x'],
    capacityPlan: { status: 'ready', originalContentTarget: 99 },
  }), (error: unknown) => (error as { code?: string }).code === 'authoritative_object_injection_forbidden');
});

test('enterprise changes create impact analysis and explicit stale snapshot/package notices', async () => {
  const store = memoryStore({
    social_programs: [{ id: 'program-row', tenant_id: 'tenant-a', program_id: 'program-a', payload: program } as Record_],
    tenant_profiles: [{ id: 'profile-a', tenant_id: 'tenant-a', version: 4, profile: { company: { description: 'Verified factory', mainMarkets: 'US', primaryLanguages: 'en' }, products: { items: [{ name: 'Serum', images: [{ id: 1 }] }] }, brand: { usp: 'Documented QC' }, customers: { targetProfiles: 'brand buyer' } } } as Record_],
    social_owned_accounts: [{ id: 'account-row', tenant_id: 'tenant-a', program_id: 'program-a', account_id: 'account-a', payload: account } as Record_],
    digital_employee_configs: [{ id: 'config-a', tenant_id: 'tenant-a', status: 'active', activated_at: now, config_version: 3, config: { autonomyMode: 'managed', approvalOwner: 'sales-a', enabledWorkflows: ['product_content', 'content_publish', 'customer_segmentation'], publishingTargets: [{ platform: 'tiktok', accountId: 'account-a', accountLabel: 'TikTok' }] } } as Record_],
    studio_production_defaults: [{ id: 'studio-a', tenant_id: 'tenant-a', payload: {} } as Record_],
  });
  const service = createSocialOperatingOrchestrationService(store, () => now);
  await service.saveConstraints('tenant-a', 'owner-a', 'program-a', { expectedVersion: 0, weeklyBudgetCny: 500, costPerOriginalCny: 50, costPerAdaptationCny: 20, materialUnitsPerOriginal: 1, productionItemsPerDay: 5, interactionItemsPerWeek: 20, salesLeadsPerWeek: 10, expectedInteractionsPerPublication: 2, expectedLeadsPerPublication: 1, accountWeeklyPublicationCapacity: { 'account-a': 5 } });
  const first = await service.resolve('tenant-a', 'owner-a', 'program-a', { weekStart: '2026-09-28', desiredOriginalContents: 1, desiredAdaptations: 0, requestedReferenceMode: 'ordinary_inspiration' });
  await createWeeklyOperatingPackageService(store).create('tenant-a', 'owner-a', 'program-a', { ...weeklyAuthorityFromResolution(first), weekStart: '2026-09-28', successCriteria: ['inquiry'] });
  (store.rows.get('tenant_profiles')![0]!.profile as any).company.mainMarkets = 'US, EU';
  (store.rows.get('tenant_profiles')![0]!.profile as any).brand.usp = 'New verified QC scope';
  const second = await service.resolve('tenant-a', 'owner-a', 'program-a', { weekStart: '2026-10-05', desiredOriginalContents: 1, desiredAdaptations: 0, requestedReferenceMode: 'ordinary_inspiration', expectedSnapshotVersion: 1 });
  assert.equal(second.goal.version, 2);
  assert.ok(second.snapshot.impacts.some(item => item.area === 'business_goal'));
  assert.ok(second.snapshot.impacts.some(item => item.area === 'authorization_review'));
  assert.ok(second.snapshot.invalidations.some(item => item.ref.type === 'operating_authority_snapshot'));
  assert.ok(second.snapshot.invalidations.some(item => item.ref.type === 'weekly_operating_package' && item.handling === 'review_required'));
});
