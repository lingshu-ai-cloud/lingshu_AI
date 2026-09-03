import { createHash } from 'node:crypto';
import { compareAndSetRecord } from '../digitalEmployees/reliableKernel.js';
import { decryptCredential, encryptCredential, type CredentialContext } from '../security/credentialEnvelope.js';
import type { DataStore } from '../storage/datastore.js';
import { withPublishQueueProjection } from './publishQueueProjection.js';
import type { PostRecord } from './waLink.js';

export type ProviderOperationEvidence = {
  operationId: string;
  accountId: string;
  platform: string;
  reference: string;
  handleCipher: string;
  observedAt: string;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function object(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch { return {}; }
  }
  return {};
}

function evidenceContext(post: Partial<PostRecord>, operationId: string, accountId: string): CredentialContext {
  return {
    scope: 'publish_operation',
    tenantId: text(post.tenant_id),
    recordId: text(post.id),
    platform: text(post.platform).toLowerCase(),
    field: `provider_handle:${text(accountId)}:${text(operationId)}`,
  };
}

export function providerOperationAuditReference(platform: string, handle: string): string {
  const normalizedPlatform = (text(platform).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'provider').slice(0, 64);
  const normalizedHandle = text(handle);
  if (!normalizedHandle) return '';
  // Provider operation handles can authorize follow-up status or publish
  // actions, and even opaque IDs unnecessarily expose provider internals.
  // Keep only an idempotent, non-reversible reference outside the encrypted
  // evidence envelope. This function intentionally accepts an existing safe
  // reference so failure and reconciliation paths cannot accidentally hash it
  // again into a different audit identity.
  const prefix = normalizedPlatform === 'youtube'
    ? 'youtube-resumable'
    : `${normalizedPlatform}-operation`;
  if (new RegExp(`^${prefix}:[a-f0-9]{64}$`).test(normalizedHandle)) return normalizedHandle;
  return `${prefix}:${createHash('sha256').update(normalizedHandle).digest('hex')}`;
}

export function providerOperationEvidencePatch(input: {
  post: Partial<PostRecord>;
  operationId: string;
  accountId: string;
  handle: string;
  observedAt?: string;
}): { stats: Record<string, unknown>; evidence: ProviderOperationEvidence } {
  const operationId = text(input.operationId);
  const accountId = text(input.accountId);
  const handle = text(input.handle);
  if (!operationId || !accountId || !handle || handle.length > 8_192) {
    throw new Error('provider_operation_evidence_invalid');
  }
  const stats = object(input.post.stats);
  const existing = object(stats.providerOperationHandles);
  const evidence: ProviderOperationEvidence = {
    operationId,
    accountId,
    platform: text(input.post.platform).toLowerCase(),
    reference: providerOperationAuditReference(text(input.post.platform), handle),
    handleCipher: encryptCredential(handle, evidenceContext(input.post, operationId, accountId)),
    observedAt: input.observedAt || new Date().toISOString(),
  };
  return {
    stats: {
      ...stats,
      providerOperationHandles: { ...existing, [accountId]: evidence },
    },
    evidence,
  };
}

export function providerOperationEvidenceForAccount(
  post: Partial<PostRecord>,
  operationId: string,
  accountId: string,
): (ProviderOperationEvidence & { handle: string }) | null {
  const stats = object(post.stats);
  const entry = object(object(stats.providerOperationHandles)[text(accountId)]) as Partial<ProviderOperationEvidence>;
  if (text(entry.operationId) !== text(operationId) || text(entry.accountId) !== text(accountId)
    || text(entry.platform) !== text(post.platform).toLowerCase() || !text(entry.handleCipher)) return null;
  const decrypted = decryptCredential(
    entry.handleCipher,
    evidenceContext(post, text(operationId), text(accountId)),
  );
  if (!decrypted.ok) return null;
  return {
    operationId: text(entry.operationId),
    accountId: text(entry.accountId),
    platform: text(entry.platform),
    reference: text(entry.reference),
    handleCipher: text(entry.handleCipher),
    observedAt: text(entry.observedAt),
    handle: decrypted.value,
  };
}

function targetAccountIds(post: Partial<PostRecord>): string[] {
  const value = object(post.stats).targetAccountIds;
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

/**
 * Durably merge the exact provider-side operation handle into a fenced publish
 * operation. Operation-state callbacks deliberately do not bump
 * `publish_revision`, so a timeout can change `active` to `quiescing` between
 * this function's read and CAS. Retrying against the state actually observed
 * makes evidence persistence commute with that transition without ever
 * reopening a provider operation.
 */
export async function persistProviderOperationEvidence(input: {
  store: DataStore;
  postId: string;
  tenantId: string;
  platform: string;
  operationId: string;
  accountId: string;
  handle: string;
  leaseOwner: string;
  leaseExtensionMs?: number;
  maxAttempts?: number;
  observedAt?: string;
}): Promise<{ record: PostRecord; evidence: ProviderOperationEvidence }> {
  const postId = text(input.postId);
  const tenantId = text(input.tenantId);
  const platform = text(input.platform).toLowerCase();
  const operationId = text(input.operationId);
  const accountId = text(input.accountId);
  const handle = text(input.handle);
  const leaseOwner = text(input.leaseOwner);
  if (!postId || !tenantId || !platform || !operationId || !accountId || !handle || !leaseOwner) {
    throw new Error('provider_operation_evidence_invalid');
  }

  for (let attempt = 0; attempt < (input.maxAttempts ?? 4); attempt += 1) {
    const current = await input.store.getById<PostRecord>('posts', postId);
    const state = text(current?.publish_operation_state);
    const directAccountId = text(current?.direct_publish_account_id);
    const currentStats = object(current?.stats);
    const currentLeaseOwner = text(current?.publish_lease_owner);
    const leaseClearedForReconciliation = state === 'quiescing'
      && !currentLeaseOwner
      && !text(current?.publish_lease_expires_at)
      && (current?.reconciliation_required === true || text(currentStats.status) === 'needs_reconciliation');
    const accountBound = directAccountId
      ? directAccountId === accountId
      : current ? targetAccountIds(current).includes(accountId) : false;
    if (!current || text(current.tenant_id) !== tenantId
      || text(current.platform).toLowerCase() !== platform
      || text(current.publish_operation_id) !== operationId
      || !['active', 'quiescing'].includes(state)
      || (currentLeaseOwner !== leaseOwner && !leaseClearedForReconciliation)
      || !accountBound) {
      throw new Error('provider_operation_evidence_fence_lost');
    }

    const existingEntry = object(object(currentStats.providerOperationHandles)[accountId]);
    if (text(existingEntry.operationId) === operationId) {
      const existing = providerOperationEvidenceForAccount(current, operationId, accountId);
      if (!existing || existing.handle !== handle) {
        throw new Error('provider_operation_evidence_conflict');
      }
      return { record: current, evidence: existing };
    }

    const evidence = providerOperationEvidencePatch({
      post: current,
      operationId,
      accountId,
      handle,
      observedAt: input.observedAt,
    });
    const leaseExpiresAt = text(current.publish_lease_expires_at);
    const extendLease = state === 'active' && Number.isFinite(input.leaseExtensionMs)
      && Number(input.leaseExtensionMs) > 0;
    const changed = await compareAndSetRecord<PostRecord>({
      store: input.store,
      collection: 'posts',
      id: current.id,
      expected: {
        publish_revision: Number(current.publish_revision || 0),
        digital_employee_fence_revision: Number(current.digital_employee_fence_revision || 0),
        publish_operation_id: operationId,
        publish_operation_state: state,
        publish_lease_owner: currentLeaseOwner,
        publish_lease_expires_at: leaseExpiresAt,
        ...(directAccountId ? { direct_publish_account_id: directAccountId } : {}),
      },
      patch: withPublishQueueProjection(current, {
        stats: evidence.stats,
        publish_revision: Number(current.publish_revision || 0) + 1,
        ...(extendLease
          ? { publish_lease_expires_at: new Date(Date.now() + Number(input.leaseExtensionMs)).toISOString() }
          : {}),
      }),
    });
    if (changed.ok) return { record: changed.record, evidence: evidence.evidence };
  }
  throw new Error('provider_operation_evidence_persistence_conflict');
}
