import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { upsertTenantPlatformApp } from '../lib/tenantPlatformApps.js';
import { createStarter198Repository, STARTER_COLLECTIONS, Starter198RepositoryError } from './repository.js';
import {
  assertStarter198ProvisioningCompatible,
  inspectStarter198ProvisioningCompatibility,
  Starter198ProvisioningCompatibilityError,
} from './provisioningCompatibility.js';
import { provisionStarter198, Starter198ProvisioningError } from './provisioning.js';
import {
  DELIVERY_PROVISIONING_FAILED,
  DELIVERY_PROVISIONING_PENDING,
  createPendingDeliveryTenant,
  deliveryProvisioningHidden,
  DeliveryTenantProvisioningNeedsAttentionError,
  provisionDeliveryStarter198,
  provisionNewDeliveryTenant,
} from './deliveryProvisioning.js';
import {
  assertLegacyExternalEffectAllowed,
  Starter198LegacyEffectError,
  withLegacyExternalEffectAllowed,
  withStarter198TenantTransitionLock,
} from './legacyEffectGuard.js';

type Row = { id: string; [key: string]: unknown };
const rows = new Map<string, Row[]>();
const bucket = (collection: string): Row[] => {
  const found = rows.get(collection) ?? [];
  rows.set(collection, found);
  return found;
};

const dataStore = {
  async getById(collection, id) { return bucket(collection).find(row => row.id === id) ?? null; },
  async create(collection, data) {
    const created = { id: `${collection}-${bucket(collection).length + 1}`, ...structuredClone(data) };
    bucket(collection).push(created);
    return created;
  },
  async update(collection, id, patch) {
    const row = bucket(collection).find(candidate => candidate.id === id);
    if (!row) return false;
    Object.assign(row, structuredClone(patch));
    return true;
  },
  async delete(collection, id) {
    const index = bucket(collection).findIndex(row => row.id === id);
    if (index < 0) return false;
    bucket(collection).splice(index, 1);
    return true;
  },
  async list(collection, query: ListQuery = {}) {
    const filtered = bucket(collection).filter(row => Object.entries(query.where ?? {})
      .every(([key, value]) => String(row[key] ?? '') === String(value)));
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    return {
      items: structuredClone(filtered.slice((page - 1) * perPage, page * perPage)),
      totalItems: filtered.length,
      totalPages: Math.ceil(filtered.length / perPage),
      page,
      perPage,
    };
  },
} as DataStore;

assert.equal(deliveryProvisioningHidden({ subscriptionStatus: DELIVERY_PROVISIONING_PENDING }), true);
assert.equal(deliveryProvisioningHidden({ subscriptionStatus: DELIVERY_PROVISIONING_FAILED }), true);
assert.equal(deliveryProvisioningHidden({ subscriptionStatus: 'pending_delivery' }), false);

const tenantId = 'starter-compatibility-tenant';
const compatibilitySource = fs.readFileSync(new URL('./provisioningCompatibility.ts', import.meta.url), 'utf8');
assert.match(compatibilitySource, /NODE_ENV === 'production'[\s\S]*pbListStrict/,
  'production compatibility checks must not inherit the legacy empty-local-store fallback');
assert.deepEqual(await inspectStarter198ProvisioningCompatibility(tenantId, dataStore), { blockers: [] });

bucket('tenant_api_keys').push(
  { id: 'foreign-key', tenant_id: 'another-tenant', api_key: 'foreign' },
  { id: 'own-key', tenant_id: tenantId, api_key: 'own' },
);
bucket('tenant_platform_apps').push({ id: 'platform-app', tenant_id: tenantId, platform: 'meta', access_token: 'encrypted' });
bucket('social_accounts').push({ id: 'social-account', tenantId, platform: 'facebook', accessToken: 'encrypted' });
bucket('youtube_accounts').push({ id: 'youtube-account', tenantId, refreshToken: 'encrypted' });
bucket('posts').push(
  { id: 'published-post', tenant_id: tenantId, stats: { status: 'published' } },
  { id: 'queued-post', tenant_id: tenantId, stats: JSON.stringify({ status: 'scheduled' }) },
  { id: 'foreign-post', tenant_id: 'another-tenant', stats: { status: 'scheduled' } },
);
bucket('followup_batches').push({ id: 'approved-batch', tenant_id: tenantId, status: 'approved' });
bucket('followup_batch_items').push(
  { id: 'sending-item', tenant_id: tenantId, status: 'sending' },
  { id: 'sent-item', tenant_id: tenantId, status: 'sent' },
);

assert.deepEqual((await inspectStarter198ProvisioningCompatibility(tenantId, dataStore)).blockers, [
  { kind: 'product_api_credentials', count: 1 },
  { kind: 'tenant_platform_credentials', count: 1 },
  { kind: 'social_account_credentials', count: 1 },
  { kind: 'youtube_account_credentials', count: 1 },
  { kind: 'scheduled_publications', count: 1 },
  { kind: 'followup_dispatches', count: 2 },
]);
await assert.rejects(
  () => assertStarter198ProvisioningCompatible(tenantId, dataStore),
  (error: unknown) => error instanceof Starter198ProvisioningCompatibilityError
    && error.code === 'starter_198_legacy_state_requires_cleanup'
    && error.status === 409,
);

const repository = createStarter198Repository(dataStore);
await assert.rejects(
  () => provisionStarter198({
    tenantId,
    actor: { userId: 'internal-admin', role: 'internal_admin' },
    idempotencyKey: 'compatibility-blocked',
    repository,
    compatibilityStore: dataStore,
  }),
  (error: unknown) => error instanceof Starter198ProvisioningError
    && error.code === 'starter_198_legacy_state_requires_cleanup'
    && error.blockers.length === 6,
);
assert.equal(bucket(STARTER_COLLECTIONS.access).filter(row => row.tenant_id === tenantId).length, 0,
  'legacy state must be rejected before any starter access row is written');

for (const collection of ['tenant_api_keys', 'tenant_platform_apps', 'social_accounts', 'youtube_accounts', 'posts', 'followup_batches', 'followup_batch_items']) {
  rows.set(collection, bucket(collection).filter(row => row.tenant_id === 'another-tenant' || row.tenantId === 'another-tenant'));
}
const provisioned = await provisionStarter198({
  tenantId,
  actor: { userId: 'internal-admin', role: 'internal_admin' },
  idempotencyKey: 'compatibility-clean',
  repository,
  compatibilityStore: dataStore,
  now: new Date('2026-09-13T00:00:00.000Z'),
});
assert.equal(provisioned.created, true);

const deliveryTenantId = 'starter-delivery-tenant';
const delivered = await provisionDeliveryStarter198({
  tenantId: deliveryTenantId,
  actorUserId: 'internal-admin',
  repository,
  compatibilityStore: dataStore,
});
assert.equal(delivered.created, true);
assert.equal(
  bucket(STARTER_COLLECTIONS.access).find(row => row.tenant_id === deliveryTenantId)?.provisioning_idempotency_key,
  `delivery:${deliveryTenantId}`,
);
assert.equal((await provisionDeliveryStarter198({
  tenantId: deliveryTenantId,
  actorUserId: 'internal-admin',
  repository,
  compatibilityStore: dataStore,
})).created, false, 'delivery provisioning must be retry-safe');

const createLostTenantId = 'create-lost-tenant';
const lifecycleEvents: string[] = [];
let loseTenantCreateResponse = true;
const createLostStore = {
  ...dataStore,
  async create(collection, data) {
    const created = await dataStore.create<Row>(collection, data);
    if (collection === 'tenants' && data.id === createLostTenantId && loseTenantCreateResponse) {
      loseTenantCreateResponse = false;
      throw new Error('tenant create response lost after commit');
    }
    if (collection === STARTER_COLLECTIONS.access && data.tenant_id === createLostTenantId) {
      lifecycleEvents.push('access_committed');
    }
    return created;
  },
  async update(collection, id, patch) {
    if (collection === 'tenants' && id === createLostTenantId && patch.inviteCode) {
      lifecycleEvents.push('invite_published');
    }
    return dataStore.update(collection, id, patch);
  },
} as DataStore;
const pendingAfterLostCreate = await createPendingDeliveryTenant({
  tenantId: createLostTenantId,
  dataStore: createLostStore,
  data: { name: 'Lost Response Co', companyName: 'Lost Response Co', subscriptionPlan: 'delivery' },
});
assert.equal(pendingAfterLostCreate.subscriptionStatus, DELIVERY_PROVISIONING_PENDING);
assert.equal(pendingAfterLostCreate.inviteCode, '', 'a recovered tenant create must remain non-registerable');
const createLostRepository = createStarter198Repository(createLostStore);
const recoveredDelivery = await provisionNewDeliveryTenant({
  tenantId: createLostTenantId,
  actorUserId: 'internal-admin',
  inviteCode: 'invite-after-access',
  dataStore: createLostStore,
  repository: createLostRepository,
  compatibilityStore: createLostStore,
});
assert.equal(recoveredDelivery.tenant.inviteCode, 'invite-after-access');
assert.deepEqual(lifecycleEvents, ['access_committed', 'invite_published'],
  'the invite must only be published after Starter access is durable');

const uncertainAccessTenantId = 'uncertain-access-tenant';
bucket('tenants').push({
  id: uncertainAccessTenantId,
  subscriptionStatus: DELIVERY_PROVISIONING_PENDING,
  subscriptionPlan: 'delivery',
  inviteCode: '',
});
const healthyUncertainRepository = createStarter198Repository(dataStore);
let uncertainAccessReads = 2;
const uncertainAccessRepository = {
  ...healthyUncertainRepository,
  async access(candidateTenantId: string) {
    if (candidateTenantId === uncertainAccessTenantId && uncertainAccessReads > 0) {
      uncertainAccessReads -= 1;
      throw new Starter198RepositoryError('starter_198_storage_unavailable');
    }
    return healthyUncertainRepository.access(candidateTenantId);
  },
};
await assert.rejects(() => provisionNewDeliveryTenant({
  tenantId: uncertainAccessTenantId,
  actorUserId: 'internal-admin',
  inviteCode: 'invite-must-wait',
  dataStore,
  repository: uncertainAccessRepository,
  compatibilityStore: dataStore,
}), DeliveryTenantProvisioningNeedsAttentionError);
assert.equal(bucket(STARTER_COLLECTIONS.access).filter(row => row.tenant_id === uncertainAccessTenantId).length, 1,
  'an uncertain post-create read must retain the entitlement for reconciliation');
assert.equal(bucket('tenants').find(row => row.id === uncertainAccessTenantId)?.subscriptionStatus, DELIVERY_PROVISIONING_PENDING,
  'an uncertain entitlement result must retain its linked pending tenant');
const resumedUncertainDelivery = await provisionNewDeliveryTenant({
  tenantId: uncertainAccessTenantId,
  actorUserId: 'internal-admin',
  inviteCode: 'invite-after-reconcile',
  dataStore,
  repository: healthyUncertainRepository,
  compatibilityStore: dataStore,
});
assert.equal(resumedUncertainDelivery.tenant.inviteCode, 'invite-after-reconcile');
assert.equal(bucket(STARTER_COLLECTIONS.access).filter(row => row.tenant_id === uncertainAccessTenantId).length, 1,
  'recovery must reuse the committed entitlement instead of creating an orphan or duplicate');

const concurrentDeliveryTenantId = 'concurrent-delivery-tenant';
bucket('tenants').push({
  id: concurrentDeliveryTenantId,
  name: 'Concurrent Delivery Co',
  companyName: 'Concurrent Delivery Co',
  subscriptionStatus: DELIVERY_PROVISIONING_PENDING,
  subscriptionPlan: 'delivery',
  inviteCode: '',
});
const concurrentDeliveries = await Promise.all([
  provisionNewDeliveryTenant({
    tenantId: concurrentDeliveryTenantId,
    actorUserId: 'internal-admin',
    inviteCode: 'concurrent-invite-a',
    dataStore,
    repository,
    compatibilityStore: dataStore,
  }),
  provisionNewDeliveryTenant({
    tenantId: concurrentDeliveryTenantId,
    actorUserId: 'internal-admin',
    inviteCode: 'concurrent-invite-b',
    dataStore,
    repository,
    compatibilityStore: dataStore,
  }),
]);
assert.equal(bucket(STARTER_COLLECTIONS.access).filter(row => row.tenant_id === concurrentDeliveryTenantId).length, 1,
  'concurrent delivery retries must converge on one Starter entitlement');
assert.equal(concurrentDeliveries[0].tenant.inviteCode, concurrentDeliveries[1].tenant.inviteCode,
  'concurrent delivery retries must return the single already-published invite');

const rollbackTenantId = 'starter-delivery-rollback';
bucket('tenants').push({
  id: rollbackTenantId,
  tenant_id: rollbackTenantId,
  subscriptionStatus: DELIVERY_PROVISIONING_PENDING,
  subscriptionPlan: 'delivery',
  inviteCode: '',
});
bucket('tenant_api_keys').push({ id: 'rollback-blocker', tenant_id: rollbackTenantId, api_key: 'legacy' });
await assert.rejects(() => provisionNewDeliveryTenant({
  tenantId: rollbackTenantId,
  actorUserId: 'internal-admin',
  inviteCode: 'must-not-be-published',
  dataStore,
  repository,
  compatibilityStore: dataStore,
}), Starter198ProvisioningError);
const failedDeliveryTenant = bucket('tenants').find(row => row.id === rollbackTenantId);
assert.equal(failedDeliveryTenant?.subscriptionStatus, DELIVERY_PROVISIONING_FAILED);
assert.equal(failedDeliveryTenant?.inviteCode, '',
  'a failed Starter entitlement must retain a recoverable tenant without exposing its invite');

const uncertainRollbackTenantId = 'starter-delivery-rollback-unverified';
bucket('tenants').push({
  id: uncertainRollbackTenantId,
  tenant_id: uncertainRollbackTenantId,
  subscriptionStatus: DELIVERY_PROVISIONING_PENDING,
  subscriptionPlan: 'delivery',
  inviteCode: '',
});
bucket('tenant_api_keys').push({ id: 'uncertain-rollback-blocker', tenant_id: uncertainRollbackTenantId, api_key: 'legacy' });
const rollbackUnavailable = {
  ...dataStore,
  async update(collection, id, patch) {
    if (collection === 'tenants' && id === uncertainRollbackTenantId) return false;
    return dataStore.update(collection, id, patch);
  },
} as DataStore;
await assert.rejects(() => provisionNewDeliveryTenant({
  tenantId: uncertainRollbackTenantId,
  actorUserId: 'internal-admin',
  inviteCode: 'must-not-be-published',
  dataStore: rollbackUnavailable,
  repository,
  compatibilityStore: dataStore,
}), DeliveryTenantProvisioningNeedsAttentionError);
assert.equal(bucket('tenants').some(row => row.id === uncertainRollbackTenantId), true,
  'an unverified failure transition must retain the tenant for reconciliation');
await assert.rejects(
  () => assertLegacyExternalEffectAllowed(tenantId, repository),
  (error: unknown) => error instanceof Starter198LegacyEffectError
    && error.code === 'starter_198_orchestrator_only' && error.status === 403,
);
await assert.doesNotReject(() => assertLegacyExternalEffectAllowed('another-tenant', repository));

bucket(STARTER_COLLECTIONS.access).push({
  id: 'corrupt-access', tenant_id: 'corrupt-tenant', product_profile: 'starter_198', profile_version: 'bad',
});
await assert.rejects(
  () => assertLegacyExternalEffectAllowed('corrupt-tenant', repository),
  (error: unknown) => error instanceof Starter198LegacyEffectError
    && error.code === 'starter_198_access_unavailable' && error.status === 503,
);

const invalidScanStore = {
  ...dataStore,
  async list(collection, query) {
    const result = await dataStore.list<Row>(collection, query);
    return collection === 'tenant_api_keys' ? { ...result, totalItems: result.totalItems + 1 } : result;
  },
} as DataStore;
await assert.rejects(
  () => inspectStarter198ProvisioningCompatibility('scan-integrity-tenant', invalidScanStore),
  (error: unknown) => error instanceof Starter198ProvisioningCompatibilityError
    && error.code === 'starter_198_migration_compatibility_unavailable' && error.status === 503,
);

const lockTenant = 'transition-lock-tenant';
let releaseEffect = () => {};
const effectGate = new Promise<void>(resolve => { releaseEffect = resolve; });
let effectStarted = false;
let transitionEntered = false;
const effect = withLegacyExternalEffectAllowed(lockTenant, async () => {
  effectStarted = true;
  await effectGate;
}, repository, dataStore);
while (!effectStarted) await Promise.resolve();
const transition = withStarter198TenantTransitionLock(
  lockTenant,
  async () => { transitionEntered = true; },
  dataStore,
);
await Promise.resolve();
assert.equal(transitionEntered, false, 'provisioning must not overtake an in-process legacy effect after its authority read');
releaseEffect();
await effect;
await transition;
assert.equal(transitionEntered, true);

const heartbeatTenant = 'transition-heartbeat-tenant';
await withStarter198TenantTransitionLock(
  heartbeatTenant,
  async guard => {
    const lease = bucket('durable_operation_leases').find(row => row.tenant_id === heartbeatTenant);
    assert.ok(lease);
    const firstExpiry = String(lease.expires_at);
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(Date.parse(String(lease.expires_at)) > Date.parse(firstExpiry),
      'the transition heartbeat must renew a lease while the protected action is still running');
    await guard.beforeEffect();
  },
  dataStore,
  { leaseDurationMs: 30_000, heartbeatIntervalMs: 5 },
);

const fencedTenant = 'transition-fenced-tenant';
await assert.rejects(
  () => withStarter198TenantTransitionLock(fencedTenant, async guard => {
    const lease = bucket('durable_operation_leases').find(row => row.tenant_id === fencedTenant);
    assert.ok(lease);
    lease.lease_token = 'successor-generation';
    await guard.beforeEffect();
  }, dataStore),
  (error: unknown) => error instanceof Starter198LegacyEffectError
    && error.code === 'starter_198_access_unavailable',
);

const blockerRaceTenant = 'transition-blocker-race';
let releaseCompatibilityScan = () => {};
const compatibilityScanGate = new Promise<void>(resolve => { releaseCompatibilityScan = resolve; });
let notifyCompatibilityScan = () => {};
const compatibilityScanStarted = new Promise<void>(resolve => { notifyCompatibilityScan = resolve; });
let blockCompatibilityScan = true;
const blockerRaceStore = {
  ...dataStore,
  async list(collection, query) {
    if (collection === 'tenant_platform_apps'
      && query?.where?.tenant_id === blockerRaceTenant && blockCompatibilityScan) {
      blockCompatibilityScan = false;
      notifyCompatibilityScan();
      await compatibilityScanGate;
    }
    return dataStore.list<Row>(collection, query);
  },
} as DataStore;
const blockerRaceRepository = createStarter198Repository(blockerRaceStore);
const concurrentProvisioning = provisionStarter198({
  tenantId: blockerRaceTenant,
  actor: { userId: 'internal-admin', role: 'internal_admin' },
  idempotencyKey: 'blocker-race-provisioning',
  repository: blockerRaceRepository,
  compatibilityStore: blockerRaceStore,
});
await compatibilityScanStarted;
const concurrentCredentialWrite = upsertTenantPlatformApp({
  tenantId: blockerRaceTenant,
  platform: 'meta',
  appId: 'must-not-be-stored-after-transition',
  dataStore: blockerRaceStore,
});
releaseCompatibilityScan();
await concurrentProvisioning;
await assert.rejects(
  concurrentCredentialWrite,
  (error: unknown) => error instanceof Starter198LegacyEffectError
    && error.code === 'starter_198_orchestrator_only',
);
assert.equal(bucket('tenant_platform_apps').some(row => row.tenant_id === blockerRaceTenant), false,
  'a blocker writer queued behind provisioning must be fenced by the new Starter access row');

console.log('starter_198 provisioning compatibility and legacy-effect guard passed');
