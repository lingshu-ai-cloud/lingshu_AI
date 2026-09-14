import { createHash, randomUUID } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import {
  acquireDurableOperationLease,
  assertDurableOperationLease,
  releaseDurableOperationLease,
  type DurableOperationLease,
} from '../runtime/durableLease.js';

export const PLATFORM_AD_TASK_LEASE_SCOPE = 'platform-ad-task';
export const PLATFORM_AD_TASK_LOCK_MESSAGE = '投放任务正在执行或需要恢复核对，请稍后重试';

const DEFAULT_LEASE_MS = 30 * 60_000;
const DEFAULT_RECLAIM_GRACE_MS = 30_000;
const PROCESS_OWNER_ID = `platform-ads:${process.pid}:${randomUUID()}`;

export type PlatformAdTaskLockErrorCode = 'platform_ad_task_busy' | 'platform_ad_task_lock_unavailable';

export class PlatformAdTaskLockError extends Error {
  readonly statusCode: 409 | 503;

  constructor(readonly code: PlatformAdTaskLockErrorCode) {
    super(PLATFORM_AD_TASK_LOCK_MESSAGE);
    this.name = 'PlatformAdTaskLockError';
    this.statusCode = code === 'platform_ad_task_busy' ? 409 : 503;
  }
}

export interface PlatformAdTaskLockDependencies {
  dataStore: DataStore;
  ownerId?: string;
  now?: () => Date;
  leaseDurationMs?: number;
  reclaimGraceMs?: number;
}

/** Stable, storage-safe subject key; the tenant remains a separate lease dimension. */
export function platformAdTaskLeaseSubject(id: string): string {
  return createHash('sha256').update(String(id)).digest('hex');
}

function configuredLeaseDuration(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(Math.max(Math.floor(parsed), 30_000), 2 * 60 * 60_000)
    : DEFAULT_LEASE_MS;
}

/**
 * Build one process instance of the lock. Its local claim set only reduces
 * contention; the database unique lease is the cross-instance authority.
 */
export function createPlatformAdTaskLock(dependencies: PlatformAdTaskLockDependencies) {
  const localClaims = new Set<string>();
  const now = dependencies.now ?? (() => new Date());
  const ownerId = dependencies.ownerId ?? PROCESS_OWNER_ID;
  const leaseDurationMs = configuredLeaseDuration(dependencies.leaseDurationMs);
  const reclaimGraceMs = dependencies.reclaimGraceMs ?? DEFAULT_RECLAIM_GRACE_MS;

  return async function withLock<T>(tenantId: string, id: string, fn: () => Promise<T>): Promise<T> {
    const localKey = JSON.stringify([tenantId, id]);
    if (localClaims.has(localKey)) throw new PlatformAdTaskLockError('platform_ad_task_busy');
    localClaims.add(localKey);
    let lease: DurableOperationLease | null = null;
    try {
      try {
        lease = await acquireDurableOperationLease({
          dataStore: dependencies.dataStore,
          tenantId,
          scope: PLATFORM_AD_TASK_LEASE_SCOPE,
          subjectId: platformAdTaskLeaseSubject(id),
          ownerId,
          now: now(),
          leaseDurationMs,
          reclaimGraceMs,
        });
      } catch {
        throw new PlatformAdTaskLockError('platform_ad_task_lock_unavailable');
      }
      if (!lease) throw new PlatformAdTaskLockError('platform_ad_task_busy');
      try {
        await assertDurableOperationLease({
          dataStore: dependencies.dataStore,
          lease,
          now: now(),
          minimumRemainingMs: 1_000,
        });
      } catch {
        throw new PlatformAdTaskLockError('platform_ad_task_lock_unavailable');
      }
      return await fn();
    } finally {
      if (lease) {
        try {
          await releaseDurableOperationLease({ dataStore: dependencies.dataStore, lease });
        } catch {
          // Do not turn a completed/ambiguous provider operation into a blind
          // retry. The bounded lease remains fail-closed until stale takeover.
        }
      }
      localClaims.delete(localKey);
    }
  };
}

const productionTaskLock = createPlatformAdTaskLock({
  dataStore: store,
  leaseDurationMs: configuredLeaseDuration(process.env.PLATFORM_AD_TASK_LEASE_MS),
});

export function withPlatformAdTaskLock<T>(tenantId: string, id: string, fn: () => Promise<T>): Promise<T> {
  return productionTaskLock(tenantId, id, fn);
}
