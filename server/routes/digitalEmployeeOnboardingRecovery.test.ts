import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import {
  ENTERPRISE_ONBOARDING_SCHEMA_VERSION,
  validateEnterpriseOnboardingConfirmation,
  type EnterpriseOnboardingDraft,
} from '../../shared/contracts/enterpriseOnboarding.js';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';

type FailureMode = 'none' | 'definite-null' | 'unknown-throw';

function memoryStore() {
  const rows = new Map<string, Record_[]>();
  let sequence = 0;
  let configFailure: FailureMode = 'none';
  let factWrites = 0;
  const store: DataStore = {
    supportsAtomicCompareAndSwapFor: async () => true,
    getById: async <T>(collection: string, id: string) =>
      (rows.get(collection)?.find(row => row.id === id) || null) as T | null,
    create: async <T>(collection: string, data: Record<string, unknown>) => {
      if (collection === 'digital_employee_configs' && configFailure !== 'none') {
        const failure = configFailure;
        configFailure = 'none';
        if (failure === 'unknown-throw') throw new Error('storage_write_outcome_unknown');
        return null;
      }
      const items = rows.get(collection) || [];
      if (collection === 'tenant_profiles' && items.some(row => row.tenant_id === data.tenant_id)) return null;
      if (collection === 'enterprise_onboarding_drafts' && items.some(row =>
        row.tenant_id === data.tenant_id && row.user_id === data.user_id)) return null;
      const created = { id: String(data.id || `test-row-${++sequence}`), ...structuredClone(data) } as Record_;
      items.push(created);
      rows.set(collection, items);
      if (collection === 'tenant_profiles') factWrites += 1;
      return created as T;
    },
    update: async (collection, id, data) => {
      const row = rows.get(collection)?.find(item => item.id === id);
      if (!row) return false;
      Object.assign(row, structuredClone(data));
      if (collection === 'tenant_profiles') factWrites += 1;
      return true;
    },
    compareAndSwap: async (collection, id, expected, data) => {
      const row = rows.get(collection)?.find(item => item.id === id);
      if (!row || !Object.entries(expected).every(([key, value]) => isDeepStrictEqual(row[key], value))) return false;
      Object.assign(row, structuredClone(data));
      if (collection === 'tenant_profiles') factWrites += 1;
      return true;
    },
    delete: async (collection, id) => {
      const items = rows.get(collection) || [];
      rows.set(collection, items.filter(row => row.id !== id));
      return items.some(row => row.id === id);
    },
    list: async <T>(collection: string, query?: ListQuery) => {
      const matches = (rows.get(collection) || []).filter(row =>
        Object.entries(query?.where || {}).every(([key, value]) => row[key] === value));
      return {
        items: matches as T[], totalItems: matches.length, totalPages: matches.length ? 1 : 0,
        page: 1, perPage: query?.perPage || 20,
      };
    },
  };
  return {
    store, rows,
    get factWrites() { return factWrites; },
    failNextConfigCreate(mode: Exclude<FailureMode, 'none'>) { configFailure = mode; },
  };
}

function completeDraft(baseFactVersion: string): EnterpriseOnboardingDraft {
  return {
    schemaVersion: ENTERPRISE_ONBOARDING_SCHEMA_VERSION,
    revision: 0,
    currentStep: 4,
    confirmationId: 'onboarding:recovery-test',
    baseFactVersion,
    companyName: '恢复测试企业',
    brandName: '恢复测试品牌',
    industry: '设备制造',
    primaryBusiness: '工业视觉检测设备',
    companyIntro: '提供工业视觉检测设备。',
    brandTone: '专业清晰',
    products: [{ id: 'product-1', name: '视觉检测设备', category: '检测设备', highlights: '高精度检测' }],
    focusProductIds: ['product-1'],
    targetMarket: '北美',
    targetBuyer: '采购经理',
    primaryPlatform: 'linkedin',
    language: '英语',
    contentStage: 'b2b_launch',
    primaryCta: '联系销售获取方案',
    sources: { companyName: 'user_provided', products: 'user_provided' },
    updatedAt: '',
  };
}

test('onboarding completion recovers a definite config-create miss without repeating confirmed facts, while unknown writes fail closed', { timeout: 15_000 }, async () => {
  const priorEnv = Object.fromEntries([
    'NODE_ENV', 'ENABLE_LOCAL_DEV_FALLBACK', 'LOCAL_DEMO_TOKEN_SECRET', 'LOCAL_AUTH_ACCOUNTS_FILE', 'DATA_BACKEND', 'DEMO_MODE',
  ].map(key => [key, process.env[key]]));
  process.env.NODE_ENV = 'test';
  process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
  process.env.LOCAL_DEMO_TOKEN_SECRET = 'onboarding-recovery-test-secret-long-enough';
  process.env.LOCAL_AUTH_ACCOUNTS_FILE = `/tmp/lingshu-no-accounts-${process.pid}-${Date.now()}.json`;
  process.env.DATA_BACKEND = 'pocketbase';
  process.env.DEMO_MODE = 'true';

  const [{ store }, authority, identity, { readTenantEnterpriseProfile }, draftRoute, onboardingRoute] = await Promise.all([
    import('../storage/index.js'),
    import('../storage/dataAuthority.js'),
    import('../auth/localIdentity.js'),
    import('./enterpriseProfileStore.js'),
    import('./enterpriseOnboardingDraft.js'),
    import('./digitalEmployeeOnboardingRoutes.js'),
  ]);
  const originalStore = { ...store };
  const fixture = memoryStore();
  Object.assign(store, fixture.store);
  const tenantId = 'tenant-onboarding-recovery-test';
  const userId = 'user-onboarding-recovery-test';
  const token = identity.issueLocalIdentityTokenForTest({ tenantId, userId, role: 'admin' });
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => authority.runWithDataAuthority('local', () => {
    res.locals.tenantId = tenantId;
    res.locals.userId = userId;
    next();
  }));
  app.use('/draft', draftRoute.createEnterpriseOnboardingDraftRouter(store));
  const digitalRouter = express.Router();
  const findFirst = async <T extends Record_>(collection: string, where: Record<string, string | number | boolean>) =>
    (await store.list<T>(collection, { where, page: 1, perPage: 1 })).items[0] || null;
  onboardingRoute.createDigitalEmployeeOnboardingRoutes({
    digitalEmployeesRouter: digitalRouter,
    configForTenant: (tenant: string) => findFirst('digital_employee_configs', { tenant_id: tenant }),
    first: findFirst,
    requiredCreate: async (collection: string, payload: Record<string, unknown>) => {
      const row = await store.create(collection, payload);
      if (!row) throw new Error('required_create_failed');
      return row;
    },
    appendAudit: async () => undefined,
    appendEvent: async () => ({ id: 'unused' }),
    buildOverview: async () => ({ status: 'ready' }),
  } as unknown as Parameters<typeof onboardingRoute.createDigitalEmployeeOnboardingRoutes>[0]).registerPostOnboardingComplete();
  app.use('/digital', digitalRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (path: string, body: unknown) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: path === '/draft' ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  try {
    const base = await authority.runWithDataAuthority('local', () => readTenantEnterpriseProfile(tenantId));
    assert.ok(base.factVersion?.id);
    assert.equal(base.company.name, '', 'a tenant without facts must not inherit the global demo profile');
    const saved = await request('/draft', { draft: completeDraft(base.factVersion.id), expectedRevision: 0 });
    assert.equal(saved.status, 200);
    const confirmed = validateEnterpriseOnboardingConfirmation({ ...saved.body.draft as object, draftRevision: 1 }).confirmation;
    assert.ok(confirmed);
    const input = {
      minimalOnboarding: true,
      companyName: confirmed.companyName,
      brandName: confirmed.brandName,
      industry: confirmed.industry,
      primaryBusiness: confirmed.primaryBusiness,
      targetMarkets: confirmed.targetMarket,
      customerProfile: confirmed.targetBuyer,
      focusProducts: confirmed.products[0]?.name,
      onboardingConfirmation: confirmed,
      publishingTargets: [],
    };

    fixture.failNextConfigCreate('definite-null');
    const first = await request('/digital/onboarding/complete', input);
    assert.equal(first.status, 503);
    assert.equal(first.body.error, 'enterprise_onboarding_completion_retryable');
    assert.equal(fixture.factWrites, 1, 'confirmed enterprise facts must commit exactly once');
    assert.equal(fixture.rows.get('digital_employee_configs')?.length || 0, 0);
    const afterFacts = await authority.runWithDataAuthority('local', () => readTenantEnterpriseProfile(tenantId));
    assert.equal(afterFacts.company.primaryBusiness, confirmed.primaryBusiness);
    assert.equal(afterFacts.company.description, confirmed.companyIntro);

    const recovered = await request('/digital/onboarding/complete', input);
    assert.equal(recovered.status, 200, 'a definite failed config create should be immediately resumable');
    assert.equal(fixture.factWrites, 1, 'retry must reuse the first confirmed fact version');
    assert.equal(fixture.rows.get('digital_employee_configs')?.length, 1);
    assert.equal(fixture.rows.get('digital_employee_config_versions')?.length, 1);
    assert.equal(fixture.rows.get('enterprise_onboarding_drafts')?.[0]?.confirmation_state, 'completed');

    const again = await request('/digital/onboarding/complete', input);
    assert.equal(again.status, 200);
    assert.equal(fixture.factWrites, 1);
    assert.equal(fixture.rows.get('digital_employee_config_versions')?.length, 1);

    // Reset only this in-memory fixture to exercise the independent uncertain
    // backend outcome: a thrown transport error cannot prove whether a write
    // committed, so the confirmation must remain claimed and return no success.
    fixture.rows.clear();
    const unsaved = await request('/draft', { draft: completeDraft(base.factVersion.id), expectedRevision: 0 });
    assert.equal(unsaved.status, 200);
    fixture.failNextConfigCreate('unknown-throw');
    const uncertain = await request('/digital/onboarding/complete', input);
    assert.equal(uncertain.status, 503);
    assert.equal(uncertain.body.error, 'enterprise_onboarding_completion_pending');
    assert.equal(fixture.factWrites, 2);
    assert.equal(fixture.rows.get('digital_employee_configs')?.length || 0, 0);
    assert.equal(fixture.rows.get('enterprise_onboarding_drafts')?.[0]?.confirmation_state, 'confirming');
    const prematureRetry = await request('/digital/onboarding/complete', input);
    assert.equal(prematureRetry.status, 409);
    assert.equal(prematureRetry.body.error, 'enterprise_onboarding_confirmation_in_progress');
    assert.equal(fixture.factWrites, 2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    Object.assign(store, originalStore);
    identity.clearLocalIdentityPrincipalsForTest();
    for (const [key, value] of Object.entries(priorEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
