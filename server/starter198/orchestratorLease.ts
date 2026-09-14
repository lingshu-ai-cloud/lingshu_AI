import { randomUUID } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';

export const STARTER_ORCHESTRATOR_LEASE_COLLECTION = 'starter_worker_leases';

/**
 * Lease records are immutable for their whole lifetime. Owners never renew or
 * replace a token in place: expiry recovery deletes the old record id and lets
 * the unique (tenant_id, task_id) index arbitrate creation of a new owner.
 * That invariant is what makes reclaim safe on the deliberately small
 * DataStore surface, which has no conditional update primitive.
 */
export interface StarterOrchestratorLease {
  id: string;
  tenant_id: string;
  task_id: string;
  lease_token: string;
  worker_id: string;
  acquired_at: string;
  expires_at: string;
}

export interface StarterOrchestratorLeaseDependencies {
  dataStore: DataStore;
  now: () => Date;
  workerId: string;
  leaseDurationMs: number;
  minimumCommitWindowMs: number;
  /**
   * Delays reclaim after expires_at to absorb bounded worker-clock skew and
   * writes that started inside minimumCommitWindowMs. It does not turn the
   * generic DataStore into a database transaction; task/run writes still need
   * a datastore-level CAS to close their final read-to-write window.
   */
  leaseReclaimGraceMs: number;
}

export class Starter198OrchestratorWorkerError extends Error {
  constructor(readonly code: string, readonly retryable = false) {
    super(code);
    this.name = 'Starter198OrchestratorWorkerError';
  }
}

function value(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}

function validDate(input: unknown): number | null {
  const parsed = Date.parse(value(input));
  return Number.isFinite(parsed) ? parsed : null;
}

function assertLeaseShape(
  lease: StarterOrchestratorLease,
  tenantId: string,
  taskId: string,
): void {
  const acquiredAt = validDate(lease.acquired_at);
  const expiresAt = validDate(lease.expires_at);
  if (!value(lease.id)
    || value(lease.tenant_id) !== tenantId
    || value(lease.task_id) !== taskId
    || !value(lease.lease_token)
    || !value(lease.worker_id)
    || acquiredAt === null
    || expiresAt === null
    || expiresAt <= acquiredAt) {
    throw new Starter198OrchestratorWorkerError(
      'starter_orchestrator_lease_integrity_violation',
      true,
    );
  }
}

async function uniqueLease(
  dataStore: DataStore,
  tenantId: string,
  taskId: string,
): Promise<StarterOrchestratorLease | null> {
  const result = await dataStore.list<StarterOrchestratorLease>(
    STARTER_ORCHESTRATOR_LEASE_COLLECTION,
    { where: { tenant_id: tenantId, task_id: taskId }, perPage: 2 },
  );
  if (!Array.isArray(result.items)
    || !Number.isSafeInteger(result.totalItems)
    || result.totalItems < 0
    || result.totalItems > 1
    || result.items.length > 1
    || (result.totalItems === 0) !== (result.items.length === 0)) {
    throw new Starter198OrchestratorWorkerError(
      'starter_orchestrator_lease_integrity_violation',
      true,
    );
  }
  const lease = result.items[0] ?? null;
  if (lease) assertLeaseShape(lease, tenantId, taskId);
  return lease;
}

function sameImmutableLease(
  left: StarterOrchestratorLease,
  right: StarterOrchestratorLease,
): boolean {
  return value(left.id) === value(right.id)
    && value(left.tenant_id) === value(right.tenant_id)
    && value(left.task_id) === value(right.task_id)
    && value(left.lease_token) === value(right.lease_token)
    && value(left.worker_id) === value(right.worker_id)
    && value(left.acquired_at) === value(right.acquired_at)
    && value(left.expires_at) === value(right.expires_at);
}

function reclaimable(
  lease: StarterOrchestratorLease,
  now: Date,
  graceMs: number,
): boolean {
  const expiresAt = validDate(lease.expires_at);
  return expiresAt !== null
    && Number.isFinite(now.getTime())
    && Number.isFinite(graceMs)
    && graceMs >= 0
    && now.getTime() >= expiresAt + graceMs;
}

function assertLeaseConfiguration(input: {
  dependencies: StarterOrchestratorLeaseDependencies;
  tenantId: string;
  taskId: string;
}): void {
  const { dependencies, tenantId, taskId } = input;
  if (!value(tenantId)
    || !value(taskId)
    || !value(dependencies.workerId)
    || !Number.isFinite(dependencies.leaseDurationMs)
    || dependencies.leaseDurationMs <= 0
    || !Number.isFinite(dependencies.minimumCommitWindowMs)
    || dependencies.minimumCommitWindowMs < 0
    || dependencies.leaseDurationMs <= dependencies.minimumCommitWindowMs
    || !Number.isFinite(dependencies.leaseReclaimGraceMs)
    || dependencies.leaseReclaimGraceMs < dependencies.minimumCommitWindowMs) {
    throw new Starter198OrchestratorWorkerError(
      'starter_orchestrator_lease_configuration_invalid',
      false,
    );
  }
}

async function createAndVerifyLease(input: {
  dependencies: StarterOrchestratorLeaseDependencies;
  tenantId: string;
  taskId: string;
  previousLeaseId?: string;
}): Promise<StarterOrchestratorLease | null> {
  assertLeaseConfiguration(input);
  const { dependencies, tenantId, taskId } = input;
  const acquiredAt = dependencies.now();
  if (!Number.isFinite(acquiredAt.getTime())) {
    throw new Starter198OrchestratorWorkerError(
      'starter_orchestrator_clock_invalid',
      true,
    );
  }
  const token = randomUUID();
  let recordId = randomUUID().replaceAll('-', '').slice(0, 15);
  while (recordId === value(input.previousLeaseId)) {
    recordId = randomUUID().replaceAll('-', '').slice(0, 15);
  }
  let created: StarterOrchestratorLease | null = null;
  try {
    created = await dependencies.dataStore.create<StarterOrchestratorLease>(
      STARTER_ORCHESTRATOR_LEASE_COLLECTION,
      {
        id: recordId,
        tenant_id: tenantId,
        task_id: taskId,
        lease_token: token,
        worker_id: dependencies.workerId,
        acquired_at: acquiredAt.toISOString(),
        expires_at: new Date(acquiredAt.getTime() + dependencies.leaseDurationMs).toISOString(),
      },
    );
  } catch {
    created = null;
  }
  if (!created) {
    const raced = await uniqueLease(dependencies.dataStore, tenantId, taskId);
    if (raced) return null;
    throw new Starter198OrchestratorWorkerError(
      'starter_orchestrator_lease_storage_unavailable',
      true,
    );
  }
  const claimed = await uniqueLease(dependencies.dataStore, tenantId, taskId);
  if (!claimed
    || value(claimed.id) !== recordId
    || value(claimed.id) !== value(created.id)
    || value(claimed.id) === value(input.previousLeaseId)
    || value(claimed.lease_token) !== token) {
    throw new Starter198OrchestratorWorkerError(
      'starter_orchestrator_lease_claim_lost',
      true,
    );
  }
  return claimed;
}

/**
 * Claims a task lease or returns null when another valid owner won. For an
 * expired record, exactly one contender can delete the old id. All contenders
 * then race a fresh create and PocketBase's unique task index chooses the only
 * effective owner. A new lease always gets a new record id and random token.
 */
export async function acquireStarterOrchestratorLease(input: {
  dependencies: StarterOrchestratorLeaseDependencies;
  tenantId: string;
  taskId: string;
}): Promise<StarterOrchestratorLease | null> {
  assertLeaseConfiguration(input);
  const { dependencies, tenantId, taskId } = input;
  const existing = await uniqueLease(dependencies.dataStore, tenantId, taskId);
  if (!existing) return createAndVerifyLease(input);
  if (!reclaimable(existing, dependencies.now(), dependencies.leaseReclaimGraceMs)) return null;

  // Re-read the exact immutable generation before deletion. Protocol users do
  // not renew leases in place; any changed field therefore means a live or
  // unknown generation and must fail closed without deleting it.
  const beforeDelete = await dependencies.dataStore.getById<StarterOrchestratorLease>(
    STARTER_ORCHESTRATOR_LEASE_COLLECTION,
    existing.id,
  );
  if (!beforeDelete) {
    const replacement = await uniqueLease(dependencies.dataStore, tenantId, taskId);
    return replacement ? null : createAndVerifyLease({ ...input, previousLeaseId: existing.id });
  }
  assertLeaseShape(beforeDelete, tenantId, taskId);
  if (!sameImmutableLease(existing, beforeDelete)
    || !reclaimable(beforeDelete, dependencies.now(), dependencies.leaseReclaimGraceMs)) {
    return null;
  }

  let deleted = false;
  try {
    deleted = await dependencies.dataStore.delete(
      STARTER_ORCHESTRATOR_LEASE_COLLECTION,
      beforeDelete.id,
    );
  } catch {
    throw new Starter198OrchestratorWorkerError(
      'starter_orchestrator_lease_storage_unavailable',
      true,
    );
  }
  if (!deleted) {
    const winner = await uniqueLease(dependencies.dataStore, tenantId, taskId);
    if (winner) return null;
  }
  return createAndVerifyLease({ ...input, previousLeaseId: beforeDelete.id });
}

export async function assertStarterOrchestratorLease(
  dependencies: StarterOrchestratorLeaseDependencies,
  lease: StarterOrchestratorLease,
): Promise<void> {
  const current = await dependencies.dataStore.getById<StarterOrchestratorLease>(
    STARTER_ORCHESTRATOR_LEASE_COLLECTION,
    lease.id,
  );
  const expiresAt = validDate(current?.expires_at);
  const nowAt = dependencies.now().getTime();
  if (!current
    || !sameImmutableLease(current, lease)
    || expiresAt === null
    || !Number.isFinite(nowAt)
    || !Number.isFinite(dependencies.minimumCommitWindowMs)
    || dependencies.minimumCommitWindowMs < 0
    || expiresAt - nowAt < dependencies.minimumCommitWindowMs) {
    throw new Starter198OrchestratorWorkerError(
      'starter_orchestrator_fence_lost',
      true,
    );
  }
}

export async function releaseStarterOrchestratorLease(
  dataStore: DataStore,
  lease: StarterOrchestratorLease,
): Promise<void> {
  try {
    const current = await dataStore.getById<StarterOrchestratorLease>(
      STARTER_ORCHESTRATOR_LEASE_COLLECTION,
      lease.id,
    );
    if (current && sameImmutableLease(current, lease)) {
      await dataStore.delete(STARTER_ORCHESTRATOR_LEASE_COLLECTION, lease.id);
    }
  } catch (error) {
    console.error(
      '[starter-orchestrator-worker] lease release failed:',
      error instanceof Error ? error.message : error,
    );
  }
}
