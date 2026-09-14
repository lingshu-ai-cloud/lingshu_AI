import { randomUUID } from 'node:crypto';
import { store } from '../storage/index.js';
import type { DataStore } from '../storage/datastore.js';
import {
  acquireDurableOperationLease,
  assertDurableOperationLease,
  releaseDurableOperationLease,
} from '../runtime/durableLease.js';
import {
  Starter198RepositoryError,
  starter198Repository,
  type Starter198Repository,
} from './repository.js';

export type Starter198LegacyEffectErrorCode =
  | 'starter_198_orchestrator_only'
  | 'starter_198_access_unavailable';

export class Starter198LegacyEffectError extends Error {
  constructor(readonly code: Starter198LegacyEffectErrorCode, readonly status: 403 | 503) {
    super(code);
    this.name = 'Starter198LegacyEffectError';
  }
}

const tenantQueues = new Map<string, Promise<void>>();
const PROFILE_TRANSITION_LEASE_SCOPE = 'product-profile-transition';
const DEFAULT_TRANSITION_LEASE_MS = 30 * 60_000;

function transitionLeaseDurationMs(): number {
  const parsed = Number(process.env.LEGACY_EXTERNAL_EFFECT_LEASE_MS);
  return Number.isFinite(parsed)
    ? Math.min(Math.max(Math.floor(parsed), 30_000), 2 * 60 * 60_000)
    : DEFAULT_TRANSITION_LEASE_MS;
}

/**
 * Serializes starter provisioning with legacy effects. The local queue avoids
 * needless contention; the durable database lease is the cross-process
 * authority that closes the final access-check/effect transition race.
 */
export async function withStarter198TenantTransitionLock<T>(
  tenantId: string,
  action: () => Promise<T>,
  dataStore: DataStore = store,
): Promise<T> {
  const prior = tenantQueues.get(tenantId) ?? Promise.resolve();
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const tail = prior.catch(() => undefined).then(() => gate);
  tenantQueues.set(tenantId, tail);
  await prior.catch(() => undefined);
  let lease: Awaited<ReturnType<typeof acquireDurableOperationLease>> = null;
  try {
    try {
      lease = await acquireDurableOperationLease({
        dataStore,
        tenantId,
        scope: PROFILE_TRANSITION_LEASE_SCOPE,
        subjectId: tenantId,
        ownerId: `profile-transition:${process.pid}:${randomUUID()}`,
        leaseDurationMs: transitionLeaseDurationMs(),
      });
    } catch {
      throw new Starter198LegacyEffectError('starter_198_access_unavailable', 503);
    }
    if (!lease) throw new Starter198LegacyEffectError('starter_198_access_unavailable', 503);
    await assertDurableOperationLease({ dataStore, lease, minimumRemainingMs: 1_000 });
    return await action();
  } finally {
    if (lease) {
      try {
        await releaseDurableOperationLease({ dataStore, lease });
      } catch {
        // The action outcome is authoritative. A release failure leaves a
        // bounded lease that expires and is reclaimed; it must not mask the
        // completed provider/provisioning result and invite a blind retry.
      }
    }
    release();
    if (tenantQueues.get(tenantId) === tail) tenantQueues.delete(tenantId);
  }
}

/**
 * A missing starter access row means the tenant remains on the legacy product.
 * Every other read outcome is denied: a valid row is starter-only, while an
 * invalid/ambiguous/unavailable row cannot safely authorize a legacy effect.
 */
export async function assertLegacyExternalEffectAllowed(
  tenantId: string,
  repository: Starter198Repository = starter198Repository,
): Promise<void> {
  try {
    await repository.access(tenantId);
  } catch (error) {
    if (error instanceof Starter198RepositoryError && error.code === 'starter_198_not_provisioned') return;
    throw new Starter198LegacyEffectError('starter_198_access_unavailable', 503);
  }
  throw new Starter198LegacyEffectError('starter_198_orchestrator_only', 403);
}

/** Hold the local transition lock from the final authority read through the effect. */
export function withLegacyExternalEffectAllowed<T>(
  tenantId: string,
  action: () => Promise<T>,
  repository: Starter198Repository = starter198Repository,
  dataStore: DataStore = store,
): Promise<T> {
  return withStarter198TenantTransitionLock(tenantId, async () => {
    await assertLegacyExternalEffectAllowed(tenantId, repository);
    return action();
  }, dataStore);
}
