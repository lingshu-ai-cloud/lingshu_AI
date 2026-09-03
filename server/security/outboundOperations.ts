import { createHash } from 'node:crypto';
import { store, type DataStore } from '../storage/index.js';

export type OutboundOperationStatus = 'pending' | 'completed' | 'failed' | 'needs_reconciliation';

export type OutboundOperationRecord = {
  id: string;
  tenant_id: string;
  idempotency_key: string;
  operation_type: string;
  target_id: string;
  payload_hash: string;
  status: OutboundOperationStatus;
  provider_message_ids?: unknown;
  result?: unknown;
  last_error_code?: string;
  revision: number;
  created_at: string;
  updated_at: string;
  completed_at?: string;
};

export type BeginOutboundOperationResult =
  | { ok: true; state: 'claimed'; operation: OutboundOperationRecord }
  | { ok: true; state: 'completed'; operation: OutboundOperationRecord }
  | { ok: false; reason: 'payload_conflict' | 'in_progress' | 'failed' | 'needs_reconciliation'; operation: OutboundOperationRecord };

function canonicalJsonValue(value: unknown, ancestors: Set<object>): unknown {
  if (!value || typeof value !== 'object') return value;
  if (ancestors.has(value)) throw new TypeError('outbound_payload_circular');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map(item => canonicalJsonValue(item, ancestors));
    if (typeof (value as { toJSON?: unknown }).toJSON === 'function') {
      return canonicalJsonValue((value as { toJSON: () => unknown }).toJSON(), ancestors);
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = canonicalJsonValue((value as Record<string, unknown>)[key], ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

export function outboundPayloadHash(value: unknown): string {
  const serialized = JSON.stringify(canonicalJsonValue(value, new Set())) ?? 'null';
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}

export function resolveOutboundIdempotencyKey(input: {
  supplied?: unknown;
  operationType: string;
  tenantId: string;
  targetId: string;
  payloadHash: string;
}): string {
  const supplied = typeof input.supplied === 'string' ? input.supplied.trim() : '';
  if (supplied) {
    if (!/^[A-Za-z0-9._:-]{8,200}$/.test(supplied)) throw new Error('idempotency_key_invalid');
    return supplied;
  }
  return `auto:${outboundPayloadHash({
    operationType: input.operationType,
    tenantId: input.tenantId,
    targetId: input.targetId,
    payloadHash: input.payloadHash,
  })}`;
}

export async function beginOutboundOperation(input: {
  collection: string;
  tenantId: string;
  idempotencyKey: string;
  operationType: string;
  targetId: string;
  payloadHash: string;
  staleAfterMs?: number;
  dataStore?: DataStore;
  nowMs?: number;
}): Promise<BeginOutboundOperationResult> {
  const dataStore = input.dataStore || store;
  const nowMs = input.nowMs ?? Date.now();
  const now = new Date(nowMs).toISOString();
  const created = await dataStore.createIfAbsent<OutboundOperationRecord>(input.collection, {
    tenant_id: input.tenantId,
    idempotency_key: input.idempotencyKey,
  }, {
    operation_type: input.operationType,
    target_id: input.targetId,
    payload_hash: input.payloadHash,
    status: 'pending',
    provider_message_ids: [],
    result: {},
    last_error_code: '',
    revision: 0,
    created_at: now,
    updated_at: now,
    completed_at: '',
  });
  const operation = created.record;
  if (created.created) return { ok: true, state: 'claimed', operation };
  if (operation.payload_hash !== input.payloadHash || operation.operation_type !== input.operationType || operation.target_id !== input.targetId) {
    return { ok: false, reason: 'payload_conflict', operation };
  }
  if (operation.status === 'completed') return { ok: true, state: 'completed', operation };
  if (operation.status === 'failed') return { ok: false, reason: 'failed', operation };
  if (operation.status === 'needs_reconciliation') return { ok: false, reason: 'needs_reconciliation', operation };

  const staleAfterMs = input.staleAfterMs ?? 5 * 60_000;
  const updatedAt = Date.parse(operation.updated_at || operation.created_at || '');
  if (Number.isFinite(updatedAt) && nowMs - updatedAt >= staleAfterMs) {
    const revision = Number(operation.revision || 0);
    const reconciled = await dataStore.compareAndSet<OutboundOperationRecord>(input.collection, operation.id, {
      status: 'pending',
      revision,
    }, {
      status: 'needs_reconciliation',
      last_error_code: 'outbound_operation_stale',
      updated_at: now,
      revision: revision + 1,
    });
    if (!reconciled.ok && reconciled.current) {
      if (reconciled.current.status === 'completed') return { ok: true, state: 'completed', operation: reconciled.current };
      if (reconciled.current.status === 'failed') return { ok: false, reason: 'failed', operation: reconciled.current };
      if (reconciled.current.status === 'pending') return { ok: false, reason: 'in_progress', operation: reconciled.current };
      return { ok: false, reason: 'needs_reconciliation', operation: reconciled.current };
    }
    return {
      ok: false,
      reason: 'needs_reconciliation',
      operation: reconciled.ok ? reconciled.record : operation,
    };
  }
  return { ok: false, reason: 'in_progress', operation };
}

async function transitionOutboundOperation(input: {
  collection: string;
  operation: OutboundOperationRecord;
  status: Exclude<OutboundOperationStatus, 'pending'>;
  patch?: Record<string, unknown>;
  dataStore?: DataStore;
}): Promise<OutboundOperationRecord | null> {
  const dataStore = input.dataStore || store;
  const revision = Number(input.operation.revision || 0);
  const now = new Date().toISOString();
  const result = await dataStore.compareAndSet<OutboundOperationRecord>(input.collection, input.operation.id, {
    status: 'pending',
    revision,
  }, {
    status: input.status,
    revision: revision + 1,
    updated_at: now,
    ...(input.status === 'completed' ? { completed_at: now } : {}),
    ...(input.patch || {}),
  });
  if (result.ok) return result.record;
  if (result.current?.status === input.status) return result.current;
  if (result.current?.status !== 'pending') return null;
  const currentRevision = Number(result.current.revision || 0);
  const retry = await dataStore.compareAndSet<OutboundOperationRecord>(input.collection, input.operation.id, {
    status: 'pending',
    revision: currentRevision,
  }, {
    status: input.status,
    revision: currentRevision + 1,
    updated_at: now,
    ...(input.status === 'completed' ? { completed_at: now } : {}),
    ...(input.patch || {}),
  });
  if (retry.ok) return retry.record;
  return retry.current?.status === input.status ? retry.current : null;
}

export function completeOutboundOperation(input: {
  collection: string;
  operation: OutboundOperationRecord;
  providerMessageIds?: string[];
  result?: Record<string, unknown>;
  dataStore?: DataStore;
}): Promise<OutboundOperationRecord | null> {
  return transitionOutboundOperation({
    ...input,
    status: 'completed',
    patch: {
      provider_message_ids: input.providerMessageIds || [],
      result: input.result || {},
      last_error_code: '',
    },
  });
}

export function markOutboundOperationFailed(input: {
  collection: string;
  operation: OutboundOperationRecord;
  errorCode: string;
  dataStore?: DataStore;
}): Promise<OutboundOperationRecord | null> {
  return transitionOutboundOperation({
    ...input,
    status: 'failed',
    patch: { last_error_code: input.errorCode.slice(0, 80) },
  });
}

export function markOutboundOperationNeedsReconciliation(input: {
  collection: string;
  operation: OutboundOperationRecord;
  errorCode: string;
  providerMessageIds?: string[];
  dataStore?: DataStore;
}): Promise<OutboundOperationRecord | null> {
  return transitionOutboundOperation({
    ...input,
    status: 'needs_reconciliation',
    patch: {
      last_error_code: input.errorCode.slice(0, 80),
      provider_message_ids: input.providerMessageIds || [],
    },
  });
}
