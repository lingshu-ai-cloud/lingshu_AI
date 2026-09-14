import { randomBytes } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import {
  Starter198RepositoryError,
  starter198Repository,
  type Starter198Repository,
} from './repository.js';
import { provisionStarter198 } from './provisioning.js';

export const DELIVERY_PROVISIONING_PENDING = 'provisioning_pending';
export const DELIVERY_PROVISIONING_FAILED = 'provisioning_failed';
export const DELIVERY_WAITING_REGISTRATION = 'pending_delivery';

type DeliveryTenant = { id: string } & Record<string, unknown>;

export class DeliveryTenantProvisioningNeedsAttentionError extends Error {
  readonly status = 503;
  readonly code = 'delivery_tenant_provisioning_needs_attention';

  constructor(readonly tenantId: string) {
    super('delivery_tenant_provisioning_needs_attention');
    this.name = 'DeliveryTenantProvisioningNeedsAttentionError';
  }
}

/** Kept as a compatibility alias for callers that handled the old rollback error. */
export class DeliveryTenantProvisioningRollbackError extends DeliveryTenantProvisioningNeedsAttentionError {
  constructor(tenantId = '') {
    super(tenantId);
    this.name = 'DeliveryTenantProvisioningRollbackError';
  }
}

export function createDeliveryTenantId(): string {
  return randomBytes(16).toString('hex').slice(0, 15);
}

export function createDeliveryInviteCode(): string {
  return randomBytes(8).toString('base64url');
}

export function deliveryProvisioningHidden(tenant: Record<string, unknown> | null | undefined): boolean {
  const status = String(tenant?.subscriptionStatus || '').trim().toLowerCase();
  return status === DELIVERY_PROVISIONING_PENDING || status === DELIVERY_PROVISIONING_FAILED;
}

function samePendingRequest(current: DeliveryTenant, expected: Record<string, unknown>): boolean {
  const status = String(current.subscriptionStatus || '').trim().toLowerCase();
  if (![DELIVERY_PROVISIONING_PENDING, DELIVERY_PROVISIONING_FAILED, DELIVERY_WAITING_REGISTRATION].includes(status)) {
    return false;
  }
  return ['name', 'companyName', 'contactName', 'contact', 'industry', 'notes', 'subscriptionPlan']
    .every(field => String(current[field] || '') === String(expected[field] || ''));
}

async function readTenant(dataStore: DataStore, tenantId: string): Promise<DeliveryTenant | null> {
  const tenant = await dataStore.getById<DeliveryTenant>('tenants', tenantId);
  if (tenant && String(tenant.id || '') !== tenantId) {
    throw new DeliveryTenantProvisioningNeedsAttentionError(tenantId);
  }
  return tenant;
}

/**
 * Preallocate the PocketBase id so a committed create with a lost response can
 * be recovered by an authoritative id read. The invite remains empty until
 * the Starter entitlement has been confirmed.
 */
export async function createPendingDeliveryTenant(input: {
  tenantId: string;
  data: Record<string, unknown>;
  dataStore?: DataStore;
}): Promise<DeliveryTenant> {
  const dataStore = input.dataStore ?? store;
  const expected = {
    ...input.data,
    id: input.tenantId,
    inviteCode: '',
    subscriptionStatus: DELIVERY_PROVISIONING_PENDING,
    subscriptionPlan: 'delivery',
  };
  let created: DeliveryTenant | null = null;
  try {
    created = await dataStore.create<DeliveryTenant>('tenants', expected);
  } catch {
    // The server may have committed before the response/connection was lost.
  }
  if (created && created.id === input.tenantId && samePendingRequest(created, expected)) return created;
  try {
    const recovered = await readTenant(dataStore, input.tenantId);
    if (recovered && samePendingRequest(recovered, expected)) return recovered;
  } catch (error) {
    if (error instanceof DeliveryTenantProvisioningNeedsAttentionError) throw error;
  }
  throw new DeliveryTenantProvisioningNeedsAttentionError(input.tenantId);
}

/** Provision the standard workspace at the internal delivery boundary. */
export async function provisionDeliveryStarter198(input: {
  tenantId: string;
  actorUserId: string;
  repository?: Starter198Repository;
  compatibilityStore?: DataStore;
}) {
  return provisionStarter198({
    tenantId: input.tenantId,
    actor: { userId: input.actorUserId, role: 'internal_admin' },
    idempotencyKey: `delivery:${input.tenantId}`,
    repository: input.repository,
    compatibilityStore: input.compatibilityStore,
  });
}

async function authoritativeAccess(
  repository: Starter198Repository,
  tenantId: string,
): Promise<
  | { kind: 'present'; access: Awaited<ReturnType<Starter198Repository['access']>> }
  | { kind: 'missing' }
  | { kind: 'unknown' }
> {
  try {
    return { kind: 'present', access: await repository.access(tenantId) };
  } catch (error) {
    if (error instanceof Starter198RepositoryError && error.code === 'starter_198_not_provisioned') {
      return { kind: 'missing' };
    }
    return { kind: 'unknown' };
  }
}

async function markProvisioningFailed(dataStore: DataStore, tenantId: string): Promise<void> {
  try {
    const current = await readTenant(dataStore, tenantId);
    if (!current) throw new DeliveryTenantProvisioningNeedsAttentionError(tenantId);
    if (String(current.subscriptionStatus || '') === DELIVERY_PROVISIONING_FAILED
      && !String(current.inviteCode || '').trim()) return;
    if (!deliveryProvisioningHidden(current)) {
      throw new DeliveryTenantProvisioningNeedsAttentionError(tenantId);
    }
    await dataStore.update('tenants', tenantId, {
      inviteCode: '',
      subscriptionStatus: DELIVERY_PROVISIONING_FAILED,
    });
    const confirmed = await readTenant(dataStore, tenantId);
    if (!confirmed || String(confirmed.subscriptionStatus || '') !== DELIVERY_PROVISIONING_FAILED
      || String(confirmed.inviteCode || '').trim()) {
      throw new DeliveryTenantProvisioningNeedsAttentionError(tenantId);
    }
  } catch (error) {
    if (error instanceof DeliveryTenantProvisioningNeedsAttentionError) throw error;
    throw new DeliveryTenantProvisioningNeedsAttentionError(tenantId);
  }
}

async function publishDeliveryInvite(input: {
  dataStore: DataStore;
  tenantId: string;
  inviteCode: string;
}): Promise<DeliveryTenant> {
  let current: DeliveryTenant | null;
  try {
    current = await readTenant(input.dataStore, input.tenantId);
  } catch {
    throw new DeliveryTenantProvisioningNeedsAttentionError(input.tenantId);
  }
  if (!current) throw new DeliveryTenantProvisioningNeedsAttentionError(input.tenantId);
  if (String(current.subscriptionStatus || '') === DELIVERY_WAITING_REGISTRATION
    && String(current.inviteCode || '').trim()) return current;
  if (!deliveryProvisioningHidden(current)) {
    throw new DeliveryTenantProvisioningNeedsAttentionError(input.tenantId);
  }
  try {
    await input.dataStore.update('tenants', input.tenantId, {
      inviteCode: input.inviteCode,
      subscriptionStatus: DELIVERY_WAITING_REGISTRATION,
    });
  } catch {
    // Re-read below: the PATCH may have committed before its response was lost.
  }
  try {
    const confirmed = await readTenant(input.dataStore, input.tenantId);
    if (confirmed
      && String(confirmed.subscriptionStatus || '') === DELIVERY_WAITING_REGISTRATION
      && String(confirmed.inviteCode || '') === input.inviteCode) return confirmed;
  } catch {
    // Preserve the pending tenant and require an idempotent recovery attempt.
  }
  throw new DeliveryTenantProvisioningNeedsAttentionError(input.tenantId);
}

/**
 * Provision and publish the invitation as a recoverable saga. A failed or
 * uncertain entitlement never deletes the tenant: it stays hidden and cannot
 * register until a later attempt confirms access and publishes the invite.
 */
export async function provisionNewDeliveryTenant(input: {
  tenantId: string;
  actorUserId: string;
  inviteCode: string;
  dataStore?: DataStore;
  repository?: Starter198Repository;
  compatibilityStore?: DataStore;
}) {
  const dataStore = input.dataStore ?? store;
  const repository = input.repository ?? starter198Repository;
  let provisioned: Awaited<ReturnType<typeof provisionDeliveryStarter198>>;
  try {
    provisioned = await provisionDeliveryStarter198({ ...input, repository });
  } catch (error) {
    const access = await authoritativeAccess(repository, input.tenantId);
    if (access.kind === 'present') {
      provisioned = { access: access.access, created: false };
    } else if (access.kind === 'missing'
      && error instanceof Error
      && 'status' in error
      && typeof error.status === 'number'
      && error.status < 500) {
      await markProvisioningFailed(dataStore, input.tenantId);
      throw error;
    } else {
      throw new DeliveryTenantProvisioningNeedsAttentionError(input.tenantId);
    }
  }

  const confirmed = await authoritativeAccess(repository, input.tenantId);
  if (confirmed.kind !== 'present') {
    throw new DeliveryTenantProvisioningNeedsAttentionError(input.tenantId);
  }
  const tenant = await publishDeliveryInvite({
    dataStore,
    tenantId: input.tenantId,
    inviteCode: input.inviteCode,
  });
  return { ...provisioned, access: confirmed.access, tenant };
}
