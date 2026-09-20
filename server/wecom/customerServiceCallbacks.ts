import { createHash, randomUUID } from 'node:crypto';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { decryptSecret, encryptSecret } from '../lib/tenantPlatformApps.js';
import {
  decryptWeComPayload,
  parseWeComEncryptedEnvelope,
  parseWeComKfCallbackXml,
  verifyWeComSignature,
} from '../integrations/wecom.js';
import {
  acquireDurableOperationLease,
  assertDurableOperationLease,
  releaseDurableOperationLease,
  renewDurableOperationLease,
  type DurableOperationLease,
} from '../runtime/durableLease.js';

const CALLBACK_MAX_AGE_MS = 10 * 60 * 1000;
const CALLBACK_LEASE_MS = 30_000;
const CALLBACK_LEASE_RECLAIM_GRACE_MS = 5_000;
const CALLBACK_LEASE_SCOPE = 'wecom-kf-callback';
const CALLBACK_LEASE_SUBJECT = 'sync';

type CallbackStatus = 'queued' | 'processing' | 'processed' | 'failed' | 'expired';

export interface WeComCallbackRecord extends Record_ {
  tenant_id: string;
  callback_key: string;
  open_kfid: string;
  status: CallbackStatus | string;
  sync_token_cipher: string;
  token_expires_at: string;
  received_at: string;
  processed_at?: string;
  updated_at: string;
  error?: string;
}

export interface WeComCallbackInput {
  tenantId: string;
  signature: string;
  timestamp: string;
  nonce: string;
  rawXml: string;
}

export interface WeComCallbackIngestion {
  callbackId: string;
  duplicate: boolean;
  status: CallbackStatus;
  shouldProcess: boolean;
}

export interface WeComCallbackProcessResult {
  callbackId: string;
  status: 'processed' | 'already_processed' | 'busy' | 'expired';
  pages: number;
  messages: number;
}

type ServiceError = Error & { status: number; code: string };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function digest(...parts: unknown[]): string {
  return createHash('sha256').update(parts.map(value => String(value ?? '')).join('\0')).digest('hex');
}

async function first<T extends Record_>(
  dataStore: DataStore,
  collection: string,
  where: Record<string, string | number | boolean>,
): Promise<T | null> {
  const result = await dataStore.list<T>(collection, { where, perPage: 1 });
  return result.items[0] ?? null;
}

function callbackStatus(value: unknown): CallbackStatus {
  const status = text(value);
  return ['queued', 'processing', 'processed', 'failed', 'expired'].includes(status)
    ? status as CallbackStatus
    : 'failed';
}

function callbackTokenExpired(record: WeComCallbackRecord, at: number): boolean {
  const expiresAt = Date.parse(record.token_expires_at);
  return !Number.isFinite(expiresAt) || expiresAt <= at;
}

export function createWeComCallbackActions<Connection>(input: {
  dataStore: DataStore;
  callbacksCollection: string;
  now: () => number;
  requireConnection: (tenantId: string) => Promise<Connection>;
  syncFromCallback: (args: {
    tenantId: string;
    connection: Connection;
    token: string;
    openKfId: string;
    tokenExpiresAt: number;
    heartbeat: () => Promise<void>;
  }) => Promise<{ pages: number; messages: number }>;
  createError: (code: string, status?: number) => ServiceError;
  workerId?: string;
}) {
  const {
    dataStore,
    callbacksCollection,
    now,
    requireConnection,
    syncFromCallback,
    createError,
  } = input;
  const workerId = input.workerId ?? `wecom-${process.pid}-${randomUUID()}`;

  async function existingIngestion(record: WeComCallbackRecord): Promise<WeComCallbackIngestion> {
    const status = callbackStatus(record.status);
    return {
      callbackId: record.id,
      duplicate: true,
      status,
      shouldProcess: status !== 'processed' && status !== 'expired',
    };
  }

  async function ingestCallback(args: WeComCallbackInput): Promise<WeComCallbackIngestion> {
    const tenantId = text(args.tenantId);
    const callbackTimestamp = Number(args.timestamp) * 1000;
    if (!tenantId || !Number.isFinite(callbackTimestamp)
      || Math.abs(now() - callbackTimestamp) > CALLBACK_MAX_AGE_MS) {
      throw createError('wecom_callback_timestamp_invalid', 403);
    }
    const connection = await requireConnection(tenantId);
    const encrypted = parseWeComEncryptedEnvelope(args.rawXml);
    if (!verifyWeComSignature({
      token: (connection as { callbackToken?: string }).callbackToken ?? '',
      timestamp: args.timestamp,
      nonce: args.nonce,
      encrypted: encrypted.encrypted,
      signature: args.signature,
    })) throw createError('wecom_callback_signature_invalid', 403);

    const corpId = text((connection as { corpId?: string }).corpId);
    const encodingAesKey = text((connection as { encodingAesKey?: string }).encodingAesKey);
    const decrypted = decryptWeComPayload({
      encodingAesKey,
      encryptedEcho: encrypted.encrypted,
      corpId,
    });
    const callback = parseWeComKfCallbackXml(decrypted.message);
    if (callback.toUserName && callback.toUserName !== corpId) {
      throw createError('wecom_corp_id_mismatch', 403);
    }
    if (callback.event !== 'kf_msg_or_event' || !callback.token) {
      throw createError('unsupported_wecom_callback_event', 400);
    }

    const callbackKey = digest(tenantId, args.timestamp, args.nonce, encrypted.encrypted);
    const existing = await first<WeComCallbackRecord>(dataStore, callbacksCollection, {
      tenant_id: tenantId,
      callback_key: callbackKey,
    });
    if (existing) {
      const status = callbackStatus(existing.status);
      if (status === 'processed' || status === 'processing') return existingIngestion(existing);
      const updatedAt = new Date(now()).toISOString();
      const revived = await dataStore.update(callbacksCollection, existing.id, {
        status: 'queued',
        sync_token_cipher: encryptSecret(callback.token),
        token_expires_at: new Date(callbackTimestamp + CALLBACK_MAX_AGE_MS).toISOString(),
        updated_at: updatedAt,
        error: '',
      });
      if (!revived) throw createError('wecom_callback_persistence_failed', 503);
      return { callbackId: existing.id, duplicate: true, status: 'queued', shouldProcess: true };
    }

    const receivedAt = new Date(now()).toISOString();
    const callbackPatch = {
      tenant_id: tenantId,
      callback_key: callbackKey,
      open_kfid: callback.openKfId,
      status: 'queued',
      sync_token_cipher: encryptSecret(callback.token),
      token_expires_at: new Date(callbackTimestamp + CALLBACK_MAX_AGE_MS).toISOString(),
      received_at: receivedAt,
      updated_at: receivedAt,
      error: '',
    };
    try {
      const created = await dataStore.create<WeComCallbackRecord>(callbacksCollection, callbackPatch);
      if (!created) throw createError('wecom_callback_persistence_failed', 503);
      return { callbackId: created.id, duplicate: false, status: 'queued', shouldProcess: true };
    } catch (error) {
      const raced = await first<WeComCallbackRecord>(dataStore, callbacksCollection, {
        tenant_id: tenantId,
        callback_key: callbackKey,
      });
      if (raced) return existingIngestion(raced);
      throw error;
    }
  }

  async function markExpired(record: WeComCallbackRecord): Promise<WeComCallbackProcessResult> {
    const updated = await dataStore.update(callbacksCollection, record.id, {
      status: 'expired',
      sync_token_cipher: '',
      error: 'wecom_callback_token_expired',
      updated_at: new Date(now()).toISOString(),
    });
    if (!updated) throw createError('wecom_callback_persistence_failed', 503);
    return { callbackId: record.id, status: 'expired', pages: 0, messages: 0 };
  }

  async function processCallback(args: {
    tenantId: string;
    callbackId: string;
  }): Promise<WeComCallbackProcessResult> {
    const tenantId = text(args.tenantId);
    const callbackId = text(args.callbackId);
    let record = await dataStore.getById<WeComCallbackRecord>(callbacksCollection, callbackId);
    if (!record || record.tenant_id !== tenantId) throw createError('wecom_callback_not_found', 404);
    if (callbackStatus(record.status) === 'processed') {
      return { callbackId, status: 'already_processed', pages: 0, messages: 0 };
    }

    let lease = await acquireDurableOperationLease({
      dataStore,
      tenantId,
      scope: CALLBACK_LEASE_SCOPE,
      // sync_msg cursors for one tenant must not advance concurrently, including
      // the `_all` stream and a callback scoped to one open_kfid.
      subjectId: CALLBACK_LEASE_SUBJECT,
      ownerId: workerId,
      now: new Date(now()),
      leaseDurationMs: CALLBACK_LEASE_MS,
      reclaimGraceMs: CALLBACK_LEASE_RECLAIM_GRACE_MS,
    });
    if (!lease) return { callbackId, status: 'busy', pages: 0, messages: 0 };

    try {
      record = await dataStore.getById<WeComCallbackRecord>(callbacksCollection, callbackId);
      if (!record || record.tenant_id !== tenantId) throw createError('wecom_callback_not_found', 404);
      if (callbackStatus(record.status) === 'processed') {
        return { callbackId, status: 'already_processed', pages: 0, messages: 0 };
      }
      if (callbackTokenExpired(record, now())) return markExpired(record);
      const token = decryptSecret(record.sync_token_cipher);
      if (!token) throw createError('wecom_callback_token_unavailable', 503);
      const connection = await requireConnection(tenantId);
      const processingAt = new Date(now()).toISOString();
      if (!await dataStore.update(callbacksCollection, callbackId, {
        status: 'processing',
        updated_at: processingAt,
        error: '',
      })) throw createError('wecom_callback_persistence_failed', 503);

      const heartbeat = async () => {
        lease = await renewDurableOperationLease({
          dataStore,
          lease: lease as DurableOperationLease,
          now: new Date(now()),
          leaseDurationMs: CALLBACK_LEASE_MS,
        });
      };
      const result = await syncFromCallback({
        tenantId,
        connection,
        token,
        openKfId: text(record.open_kfid),
        tokenExpiresAt: Date.parse(record.token_expires_at),
        heartbeat,
      });
      await assertDurableOperationLease({ dataStore, lease, now: new Date(now()) });
      const processedAt = new Date(now()).toISOString();
      if (!await dataStore.update(callbacksCollection, callbackId, {
        status: 'processed',
        sync_token_cipher: '',
        processed_at: processedAt,
        updated_at: processedAt,
        error: '',
      })) throw createError('wecom_callback_persistence_failed', 503);
      return { callbackId, status: 'processed', ...result };
    } catch (error) {
      try {
        await assertDurableOperationLease({ dataStore, lease, now: new Date(now()) });
        await dataStore.update(callbacksCollection, callbackId, {
          status: 'failed',
          error: error instanceof Error ? error.message.slice(0, 500) : 'wecom_sync_failed',
          updated_at: new Date(now()).toISOString(),
        });
      } catch {
        // A successor that reclaimed an expired lease owns the callback state.
      }
      throw error;
    } finally {
      await releaseDurableOperationLease({ dataStore, lease }).catch(() => undefined);
    }
  }

  async function recoverCallbacks(args: { tenantId: string; limit?: number }) {
    const tenantId = text(args.tenantId);
    await requireConnection(tenantId);
    const limit = Math.min(100, Math.max(1, Number(args.limit) || 25));
    const candidates = new Map<string, WeComCallbackRecord>();
    for (const status of ['queued', 'failed', 'processing'] as const) {
      const rows = await dataStore.list<WeComCallbackRecord>(callbacksCollection, {
        where: { tenant_id: tenantId, status },
        sort: 'received_at',
        perPage: limit,
      });
      for (const row of rows.items) candidates.set(row.id, row);
    }
    const selected = [...candidates.values()]
      .sort((left, right) => left.received_at.localeCompare(right.received_at))
      .slice(0, limit);
    const summary = { attempted: selected.length, processed: 0, alreadyProcessed: 0, busy: 0, expired: 0, failed: 0 };
    for (const record of selected) {
      try {
        const result = await processCallback({ tenantId, callbackId: record.id });
        if (result.status === 'processed') summary.processed += 1;
        else if (result.status === 'already_processed') summary.alreadyProcessed += 1;
        else if (result.status === 'busy') summary.busy += 1;
        else summary.expired += 1;
      } catch {
        summary.failed += 1;
      }
    }
    return summary;
  }

  return { ingestCallback, processCallback, recoverCallbacks };
}
