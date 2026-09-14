import assert from 'node:assert/strict';
import { STARTER_198_CAPABILITIES } from '../../shared/contracts/starter198.js';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { createStarter198InitialSetupPort } from './initialSetup.js';
import { createStarter198Repository, STARTER_COLLECTIONS } from './repository.js';
import { Starter198RuntimePortError } from './runtimePorts.js';

type Row = { id: string } & Record<string, unknown>;
const tenantId = 'starter-setup-tenant';
const rows = new Map<string, Row[]>();
let serial = 0;
let beforeVersionCreate: (() => Promise<void>) | null = null;
const writeEvents: string[] = [];

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

const dataStore: DataStore = {
  async getById(collection, id) { return structuredClone(rows.get(collection)?.find(row => row.id === id) ?? null) as never; },
  async list(collection: string, query: ListQuery = {}) {
    const selected = (rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {})
      .every(([key, value]) => String(row[key] ?? '') === String(value)));
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    return { items: structuredClone(selected) as never[], totalItems: selected.length, totalPages: Math.ceil(selected.length / perPage), page, perPage };
  },
  async create(collection, data) {
    if (collection === 'digital_employee_config_versions' && beforeVersionCreate) {
      await beforeVersionCreate();
    }
    writeEvents.push(`create:${collection}`);
    const row = { id: `setup${String(++serial).padStart(10, '0')}`, ...structuredClone(data) } as Row;
    rows.set(collection, [...(rows.get(collection) ?? []), row]);
    return structuredClone(row) as never;
  },
  async update(collection, id, patch) {
    const row = rows.get(collection)?.find(item => item.id === id);
    if (!row) return false;
    writeEvents.push(`update:${collection}`);
    Object.assign(row, structuredClone(patch));
    return true;
  },
  async delete() { return false; },
};

rows.set(STARTER_COLLECTIONS.access, [{
  id: 'access-setup', tenant_id: tenantId, product_profile: 'starter_198', profile_version: 'starter_198.v1',
  entitlement_snapshot_id: 'snapshot-setup',
  feature_entitlements: STARTER_198_CAPABILITIES.map(capability => ({ capability, enabled: true })),
  resource_limits: {
    workspaceCount: 1, brandCount: 1, memberCount: 2, agentTeamCount: 1,
    productCount: 1, marketCount: 1, buyerPersonaCount: 1, languageCount: 1,
    primaryPlatformCount: 1, concurrentRunCount: 1, contentArtifactCountPerCycle: 2,
    contentRevisionCountPerCycle: 1, publicationPackageCountPerContent: 1,
    assistedSessionCount: 0, inquiryAiCountPerCycle: 10, quoteDraftCountPerCycle: 10,
    highCostVideoCount: 0, budgetCnyPerCycle: 100,
    agentBudgetCny: { orchestrator: 25, content: 25, traffic: 25, sales: 25 },
  },
  status: 'active', cycle_started_at: '2026-09-01T00:00:00.000Z', cycle_ends_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-09-12T00:00:00.000Z',
}]);
rows.set(STARTER_COLLECTIONS.runs, []);
rows.set('tenant_profiles', []);
rows.set('digital_employee_configs', []);
rows.set('digital_employee_config_versions', []);

const repository = createStarter198Repository(dataStore);
const port = createStarter198InitialSetupPort({
  dataStore,
  repository,
  now: () => new Date('2026-09-12T08:00:00.000Z'),
});
const setup = {
  companyName: '青山制造',
  industry: '礼品制造',
  primaryBusiness: '保温杯 OEM/ODM',
  focusProducts: 'TB-750 保温杯',
  targetMarkets: '德国',
  customerProfile: '礼品经销商',
  primaryPlatform: 'tiktok' as const,
  primaryLanguage: 'en',
  constraints: ['不得编造材质参数'],
};
const first = await port.configure({ tenantId, userId: 'owner-setup', idempotencyKey: 'initial-setup-001', setup });
assert.equal(first.repeated, false);
assert.equal(first.configVersion, 1);
const profile = rows.get('tenant_profiles')?.[0].profile as Record<string, any>;
assert.equal(profile.company.name, setup.companyName);
assert.equal(profile.products.items[0].name, setup.focusProducts);
const config = rows.get('digital_employee_configs')?.[0].config as Record<string, any>;
assert.deepEqual(config.publishingTargets, []);
assert.equal(config.allowRealPublishing, false);
assert.equal(config.allowRealCustomerMessages, false);
assert.equal(config.allowGeneratedVisuals, false);
assert.deepEqual(config.enabledWorkflows, ['product_content', 'content_publish', 'customer_segmentation']);
assert.equal(config.approvalOwner, 'owner-setup');
assert.equal(rows.get('digital_employee_config_versions')?.length, 1);

const replay = await port.configure({ tenantId, userId: 'owner-setup', idempotencyKey: 'initial-setup-001', setup });
assert.equal(replay.repeated, true);
assert.equal(replay.configVersion, 1);
assert.equal(rows.get('tenant_profiles')?.length, 1);
assert.equal(rows.get('digital_employee_configs')?.length, 1);
assert.equal(rows.get('digital_employee_config_versions')?.length, 1);

rows.get(STARTER_COLLECTIONS.runs)!.push({
  id: 'active-run', tenant_id: tenantId, status: 'waiting_human', product_profile: 'starter_198',
});
await assert.rejects(
  () => port.configure({ ...{ tenantId, userId: 'owner-setup', setup }, idempotencyKey: 'initial-setup-002' }),
  (error: unknown) => error instanceof Starter198RuntimePortError
    && error.code === 'starter_198_initial_setup_run_active',
  'waiting_human remains active and blocks configuration replacement',
);
rows.get(STARTER_COLLECTIONS.runs)![0].status = 'cancelling';
await assert.rejects(
  () => port.configure({ ...{ tenantId, userId: 'owner-setup', setup }, idempotencyKey: 'initial-setup-003' }),
  (error: unknown) => error instanceof Starter198RuntimePortError
    && error.code === 'starter_198_initial_setup_run_active',
  'cancelling remains active and blocks configuration replacement',
);

rows.get(STARTER_COLLECTIONS.runs)![0].status = 'completed';
writeEvents.length = 0;
const otherPortInstance = createStarter198InitialSetupPort({
  dataStore,
  repository,
  now: () => new Date('2026-09-12T08:00:00.000Z'),
});
const firstVersionCreateReached = deferred();
const releaseFirstVersionCreate = deferred();
let versionCreateEntries = 0;
beforeVersionCreate = async () => {
  versionCreateEntries += 1;
  if (versionCreateEntries === 1) {
    firstVersionCreateReached.resolve();
    await releaseFirstVersionCreate.promise;
  }
};
const setupA = { ...setup, companyName: '青山制造 A' };
const setupB = { ...setup, companyName: '青山制造 B' };
const pendingA = port.configure({
  tenantId, userId: 'owner-setup', idempotencyKey: 'initial-setup-004', setup: setupA,
});
await firstVersionCreateReached.promise;
const pendingB = otherPortInstance.configure({
  tenantId, userId: 'owner-setup', idempotencyKey: 'initial-setup-005', setup: setupB,
});
await new Promise<void>(resolve => setImmediate(resolve));
assert.equal(versionCreateEntries, 1, 'a second port instance must wait on the tenant-wide setup barrier');
releaseFirstVersionCreate.resolve();
const [resultA, resultB] = await Promise.all([pendingA, pendingB]);
beforeVersionCreate = null;
assert.deepEqual([resultA.configVersion, resultB.configVersion], [2, 3]);

const activeConfig = rows.get('digital_employee_configs')?.[0];
assert.equal(activeConfig?.config_version, resultB.configVersion);
assert.equal((activeConfig?.effective_config as Record<string, any>).initialSetup.idempotencyKey, 'initial-setup-005');
assert.equal((activeConfig?.config as Record<string, any>).companyName, setupB.companyName);
const activeProfile = rows.get('tenant_profiles')?.[0].profile as Record<string, any>;
assert.equal(activeProfile.company.name, setupB.companyName);
const activeVersion = rows.get('digital_employee_config_versions')?.find(
  row => row.config_version === activeConfig?.config_version,
);
assert.ok(activeVersion, 'the active configuration must always have its immutable version');
assert.deepEqual(activeVersion.config, activeConfig?.config);
assert.equal(activeVersion.policy_version, activeConfig?.policy_version);
assert.equal(activeVersion.facts_version, activeConfig?.facts_version);
assert.equal(rows.get('digital_employee_config_versions')?.length, 3);
assert.deepEqual(writeEvents, [
  'create:digital_employee_config_versions',
  'update:tenant_profiles',
  'update:digital_employee_configs',
  'create:digital_employee_config_versions',
  'update:tenant_profiles',
  'update:digital_employee_configs',
], 'each serialized setup writes its immutable version before advancing mutable projections');

console.log('starter initial setup passed: immutable-first activation, tenant serialization, replay and active-run guard');
