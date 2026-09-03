import { createHash } from 'node:crypto';
import { store, type DataStore } from '../storage/index.js';
import type { OutboundOperationRecord } from '../security/outboundOperations.js';

export const WHATSAPP_DELIVERY_RECEIPT_COLLECTION = 'whatsapp_delivery_receipts';
export const WHATSAPP_OUTBOUND_OPERATION_COLLECTION = 'whatsapp_outbound_operations';

type DeliveryStatus = 'accepted' | 'sent' | 'delivered' | 'read' | 'failed';

type DeliveryReceiptRecord = {
  id: string;
  tenant_id: string;
  provider_message_id: string;
  outbound_operation_id?: string;
  status: DeliveryStatus;
  provider_timestamp?: string;
  recipient_hash?: string;
  error_code?: string;
  revision: number;
  created_at: string;
  updated_at: string;
};

const STATUS_RANK: Record<DeliveryStatus, number> = {
  accepted: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function normalizeStatus(value: unknown): DeliveryStatus | null {
  const status = text(value).toLowerCase();
  return status === 'sent' || status === 'delivered' || status === 'read' || status === 'failed'
    ? status
    : null;
}

function providerTimestamp(value: unknown): string {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : '';
}

function recipientHash(value: unknown): string {
  const normalized = text(value).replace(/[^\d]/g, '');
  return normalized ? createHash('sha256').update(normalized).digest('hex') : '';
}

async function attachReceiptToOperation(
  receipt: DeliveryReceiptRecord,
  operationId: string,
  dataStore: DataStore,
): Promise<DeliveryReceiptRecord> {
  let current = receipt;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (current.outbound_operation_id === operationId) return current;
    if (current.outbound_operation_id) throw new Error('whatsapp_provider_message_operation_conflict');
    const revision = Number(current.revision || 0);
    const updated = await dataStore.compareAndSet<DeliveryReceiptRecord>(WHATSAPP_DELIVERY_RECEIPT_COLLECTION, current.id, {
      revision,
    }, {
      outbound_operation_id: operationId,
      revision: revision + 1,
      updated_at: new Date().toISOString(),
    });
    if (updated.ok) return updated.record;
    if (!updated.current) throw new Error('whatsapp_delivery_receipt_missing');
    current = updated.current;
  }
  throw new Error('whatsapp_delivery_receipt_conflict');
}

export async function registerWhatsAppOutboundMessages(input: {
  tenantId: string;
  operationId: string;
  providerMessageIds: string[];
  dataStore?: DataStore;
}): Promise<void> {
  const dataStore = input.dataStore || store;
  const operation = await dataStore.getById<OutboundOperationRecord>(WHATSAPP_OUTBOUND_OPERATION_COLLECTION, input.operationId);
  if (!operation || operation.tenant_id !== input.tenantId) throw new Error('whatsapp_outbound_operation_identity_invalid');
  const now = new Date().toISOString();
  for (const providerMessageId of input.providerMessageIds.map(text).filter(Boolean)) {
    const created = await dataStore.createIfAbsent<DeliveryReceiptRecord>(WHATSAPP_DELIVERY_RECEIPT_COLLECTION, {
      tenant_id: input.tenantId,
      provider_message_id: providerMessageId,
    }, {
      outbound_operation_id: input.operationId,
      status: 'accepted',
      provider_timestamp: '',
      recipient_hash: '',
      error_code: '',
      revision: 0,
      created_at: now,
      updated_at: now,
    });
    const receipt = created.created
      ? created.record
      : await attachReceiptToOperation(created.record, input.operationId, dataStore);
    await updateOperationDelivery(receipt, receipt.status, dataStore);
  }
}

async function updateOperationDelivery(
  receipt: DeliveryReceiptRecord,
  status: DeliveryStatus,
  dataStore: DataStore,
): Promise<void> {
  if (!receipt.outbound_operation_id) return;
  let operation = await dataStore.getById<OutboundOperationRecord & Record<string, unknown>>(
    WHATSAPP_OUTBOUND_OPERATION_COLLECTION,
    receipt.outbound_operation_id,
  );
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (!operation || operation.tenant_id !== receipt.tenant_id) return;
    const currentStatus = normalizeOperationStatus(operation.delivery_status);
    if (currentStatus === 'failed' || (currentStatus && STATUS_RANK[status] <= STATUS_RANK[currentStatus])) return;
    const revision = Number(operation.revision || 0);
    const updated = await dataStore.compareAndSet<OutboundOperationRecord & Record<string, unknown>>(
      WHATSAPP_OUTBOUND_OPERATION_COLLECTION,
      operation.id,
      { revision },
      {
        delivery_status: status,
        delivery_updated_at: new Date().toISOString(),
        revision: revision + 1,
      },
    );
    if (updated.ok) return;
    operation = updated.current || null;
  }
  throw new Error('whatsapp_outbound_delivery_conflict');
}

function normalizeOperationStatus(value: unknown): DeliveryStatus | null {
  const status = text(value).toLowerCase();
  return status === 'accepted' || status === 'sent' || status === 'delivered' || status === 'read' || status === 'failed'
    ? status
    : null;
}

export async function recordWhatsAppDeliveryStatus(input: {
  tenantId: string;
  providerMessageId: string;
  status: DeliveryStatus;
  timestamp?: string;
  recipientId?: string;
  errorCode?: string;
  dataStore?: DataStore;
}): Promise<void> {
  const dataStore = input.dataStore || store;
  const tenantId = text(input.tenantId);
  const providerMessageId = text(input.providerMessageId);
  if (!tenantId || !providerMessageId) throw new Error('whatsapp_delivery_identity_invalid');
  const now = new Date().toISOString();
  const created = await dataStore.createIfAbsent<DeliveryReceiptRecord>(WHATSAPP_DELIVERY_RECEIPT_COLLECTION, {
    tenant_id: tenantId,
    provider_message_id: providerMessageId,
  }, {
    outbound_operation_id: '',
    status: input.status,
    provider_timestamp: input.timestamp || '',
    recipient_hash: recipientHash(input.recipientId),
    error_code: text(input.errorCode).slice(0, 80),
    revision: 0,
    created_at: now,
    updated_at: now,
  });
  let receipt = created.record;
  if (!created.created) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (receipt.status === 'failed' || STATUS_RANK[input.status] <= STATUS_RANK[receipt.status]) break;
      const revision = Number(receipt.revision || 0);
      const updated = await dataStore.compareAndSet<DeliveryReceiptRecord>(WHATSAPP_DELIVERY_RECEIPT_COLLECTION, receipt.id, {
        status: receipt.status,
        revision,
      }, {
        status: input.status,
        provider_timestamp: input.timestamp || receipt.provider_timestamp || '',
        recipient_hash: recipientHash(input.recipientId) || receipt.recipient_hash || '',
        error_code: text(input.errorCode).slice(0, 80),
        revision: revision + 1,
        updated_at: now,
      });
      if (updated.ok) {
        receipt = updated.record;
        break;
      }
      if (!updated.current) throw new Error('whatsapp_delivery_receipt_missing');
      receipt = updated.current;
      if (attempt === 7) throw new Error('whatsapp_delivery_receipt_conflict');
    }
  }
  await updateOperationDelivery(receipt, receipt.status, dataStore);
}

export async function trackMetaWhatsAppStatuses(
  tenantId: string,
  payload: unknown,
  dataStore: DataStore = store,
): Promise<number> {
  const root = payload && typeof payload === 'object' ? payload as { entry?: unknown } : {};
  const entries = Array.isArray(root.entry) ? root.entry : [];
  let tracked = 0;
  for (const entry of entries) {
    const changes = entry && typeof entry === 'object' && Array.isArray((entry as { changes?: unknown }).changes)
      ? (entry as { changes: unknown[] }).changes
      : [];
    for (const change of changes) {
      const value = change && typeof change === 'object' ? (change as { value?: unknown }).value : null;
      const statuses = value && typeof value === 'object' && Array.isArray((value as { statuses?: unknown }).statuses)
        ? (value as { statuses: unknown[] }).statuses
        : [];
      for (const raw of statuses) {
        if (!raw || typeof raw !== 'object') continue;
        const statusObject = raw as { id?: unknown; status?: unknown; timestamp?: unknown; recipient_id?: unknown; errors?: unknown };
        const providerMessageId = text(statusObject.id);
        const status = normalizeStatus(statusObject.status);
        if (!providerMessageId || !status) continue;
        const errors = Array.isArray(statusObject.errors) ? statusObject.errors : [];
        const firstError = errors[0] && typeof errors[0] === 'object' ? errors[0] as { code?: unknown } : {};
        await recordWhatsAppDeliveryStatus({
          tenantId,
          providerMessageId,
          status,
          timestamp: providerTimestamp(statusObject.timestamp),
          recipientId: text(statusObject.recipient_id),
          errorCode: text(firstError.code),
          dataStore,
        });
        tracked += 1;
      }
    }
  }
  return tracked;
}
