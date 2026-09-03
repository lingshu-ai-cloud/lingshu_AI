import type { DataStore, Record_ } from '../storage/datastore.js';

export const WHATSAPP_INBOUND_RECEIPT_COLLECTION = 'webhook_message_receipts';

export type InboundReceiptStatus = 'processing' | 'completed' | 'needs_reconciliation';

export type InboundReceipt = Record_ & {
  tenant_id: string;
  provider: string;
  message_id: string;
  status: InboundReceiptStatus;
  revision: number;
  received_at: string;
  updated_at: string;
  claim_expires_at?: string;
  completed_at?: string;
  last_error_code?: string;
  reconciled_at?: string;
  reconciled_by?: string;
  reconciliation_resolution?: string;
  reconciliation_note?: string;
};

export type InboundReceiptOutcome = 'processed' | 'duplicate' | 'in_progress' | 'needs_reconciliation';

function positiveInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function inboundReceiptLeaseMs(env: NodeJS.ProcessEnv = process.env): number {
  return positiveInteger(env.WHATSAPP_INBOUND_RECEIPT_LEASE_MS, 30 * 60_000, 60_000, 4 * 60 * 60_000);
}

function errorCode(error: unknown): string {
  const raw = error instanceof Error ? error.name : 'unknown_error';
  const normalized = raw.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 80);
  return normalized || 'unknown_error';
}

function revision(record: InboundReceipt): number {
  const value = Number(record.revision);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/**
 * Fence one provider message before any customer mutation or outbound reply.
 * A stale/failed claim is never replayed automatically because its external
 * side effects are unknowable after a crash; it is surfaced for reconciliation.
 */
export async function processInboundExactlyOnce(input: {
  store: DataStore;
  tenantId: string;
  provider: string;
  messageId: string;
  work: () => Promise<void>;
  now?: () => Date;
  leaseMs?: number;
}): Promise<{ outcome: InboundReceiptOutcome; receipt: InboundReceipt }> {
  const now = input.now ?? (() => new Date());
  const startedAt = now();
  const leaseMs = input.leaseMs ?? inboundReceiptLeaseMs();
  const tenantId = input.tenantId.trim();
  const provider = input.provider.trim().toLowerCase();
  const messageId = input.messageId.trim();
  if (!tenantId || !provider || !messageId) throw new Error('inbound_receipt_identity_required');

  const claimed = await input.store.createIfAbsent<InboundReceipt>(
    WHATSAPP_INBOUND_RECEIPT_COLLECTION,
    { tenant_id: tenantId, provider, message_id: messageId },
    {
      status: 'processing',
      revision: 0,
      received_at: startedAt.toISOString(),
      updated_at: startedAt.toISOString(),
      claim_expires_at: new Date(startedAt.getTime() + leaseMs).toISOString(),
      completed_at: '',
      last_error_code: '',
    },
  );

  if (!claimed.created) {
    const current = claimed.record;
    if (current.status === 'completed') return { outcome: 'duplicate', receipt: current };
    if (current.status === 'needs_reconciliation') return { outcome: 'needs_reconciliation', receipt: current };

    const expiresAt = Date.parse(String(current.claim_expires_at || ''));
    if (Number.isFinite(expiresAt) && expiresAt <= startedAt.getTime()) {
      const fenced = await input.store.compareAndSet<InboundReceipt>(
        WHATSAPP_INBOUND_RECEIPT_COLLECTION,
        current.id,
        { status: 'processing', revision: revision(current) },
        {
          status: 'needs_reconciliation',
          revision: revision(current) + 1,
          updated_at: startedAt.toISOString(),
          last_error_code: 'processing_lease_expired',
        },
      );
      const receipt = fenced.ok ? fenced.record : (fenced.current ?? current);
      return {
        outcome: receipt.status === 'completed' ? 'duplicate' : 'needs_reconciliation',
        receipt,
      };
    }
    return { outcome: 'in_progress', receipt: current };
  }

  const receipt = claimed.record;
  try {
    await input.work();
  } catch (error) {
    const failedAt = now().toISOString();
    await input.store.compareAndSet<InboundReceipt>(
      WHATSAPP_INBOUND_RECEIPT_COLLECTION,
      receipt.id,
      { status: 'processing', revision: revision(receipt) },
      {
        status: 'needs_reconciliation',
        revision: revision(receipt) + 1,
        updated_at: failedAt,
        last_error_code: errorCode(error),
      },
    );
    throw error;
  }

  const completedAt = now().toISOString();
  const completed = await input.store.compareAndSet<InboundReceipt>(
    WHATSAPP_INBOUND_RECEIPT_COLLECTION,
    receipt.id,
    { status: 'processing', revision: revision(receipt) },
    {
      status: 'completed',
      revision: revision(receipt) + 1,
      completed_at: completedAt,
      updated_at: completedAt,
      claim_expires_at: '',
      last_error_code: '',
    },
  );
  if (!completed.ok) {
    // Work may already have reached external systems, so a CAS conflict is a
    // reconciliation event and must never result in automatic replay.
    throw new Error('inbound_receipt_completion_conflict');
  }
  return { outcome: 'processed', receipt: completed.record };
}

export async function inboundReceiptHealthCheck(input: {
  store: DataStore;
  now?: Date;
}): Promise<{ ok: boolean; message?: string; details?: Record<string, unknown> }> {
  const failed = await input.store.list<InboundReceipt>(WHATSAPP_INBOUND_RECEIPT_COLLECTION, {
    where: { status: 'needs_reconciliation' },
    page: 1,
    perPage: 1,
  });
  if (failed.totalItems > 0) {
    return { ok: false, message: 'whatsapp_inbound_reconciliation_required', details: { count: failed.totalItems } };
  }

  const processing = await input.store.list<InboundReceipt>(WHATSAPP_INBOUND_RECEIPT_COLLECTION, {
    where: { status: 'processing' },
    sort: 'claim_expires_at',
    page: 1,
    perPage: 100,
  });
  const nowMs = (input.now ?? new Date()).getTime();
  const stale = processing.items.filter(item => {
    const expiry = Date.parse(String(item.claim_expires_at || ''));
    return !Number.isFinite(expiry) || expiry <= nowMs;
  }).length;
  if (stale > 0) {
    return {
      ok: false,
      message: 'whatsapp_inbound_processing_stale',
      details: { stale, processing: processing.totalItems },
    };
  }
  return { ok: true, details: { processing: processing.totalItems } };
}
