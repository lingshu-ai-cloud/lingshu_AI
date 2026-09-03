import assert from 'node:assert/strict';
import { beginOutboundOperation, outboundPayloadHash } from '../security/outboundOperations.js';
import { MemoryAtomicStore } from '../testing/memoryAtomicStore.js';
import {
  registerWhatsAppOutboundMessages,
  recordWhatsAppDeliveryStatus,
  trackMetaWhatsAppStatuses,
  WHATSAPP_DELIVERY_RECEIPT_COLLECTION,
  WHATSAPP_OUTBOUND_OPERATION_COLLECTION,
} from './deliveryTracking.js';

type Receipt = {
  id: string;
  tenant_id: string;
  provider_message_id: string;
  outbound_operation_id?: string;
  status: string;
  recipient_hash?: string;
  revision: number;
};

const store = new MemoryAtomicStore();
const operationResult = await beginOutboundOperation({
  collection: WHATSAPP_OUTBOUND_OPERATION_COLLECTION,
  tenantId: 'tenant-a',
  idempotencyKey: 'wa:test:tenant-a:operation-1',
  operationType: 'whatsapp_suggestion',
  targetId: 'customer-a',
  payloadHash: outboundPayloadHash({ message: 'hello' }),
  dataStore: store,
});
assert.equal(operationResult.ok && operationResult.state, 'claimed');
if (!operationResult.ok) throw new Error('operation_setup_failed');
const operationId = operationResult.operation.id;

await Promise.all([
  registerWhatsAppOutboundMessages({ tenantId: 'tenant-a', operationId, providerMessageIds: ['wamid.shared'], dataStore: store }),
  registerWhatsAppOutboundMessages({ tenantId: 'tenant-a', operationId, providerMessageIds: ['wamid.shared'], dataStore: store }),
]);
assert.equal(store.all<Receipt>(WHATSAPP_DELIVERY_RECEIPT_COLLECTION).length, 1, 'concurrent registration must not duplicate provider IDs');

await recordWhatsAppDeliveryStatus({
  tenantId: 'tenant-a', providerMessageId: 'wamid.shared', status: 'delivered', recipientId: '+86 138-0000-0000', dataStore: store,
});
await recordWhatsAppDeliveryStatus({
  tenantId: 'tenant-a', providerMessageId: 'wamid.shared', status: 'sent', recipientId: '+86 138-0000-0000', dataStore: store,
});
let tenantAReceipt = store.all<Receipt>(WHATSAPP_DELIVERY_RECEIPT_COLLECTION)
  .find(record => record.tenant_id === 'tenant-a' && record.provider_message_id === 'wamid.shared');
assert.equal(tenantAReceipt?.status, 'delivered', 'out-of-order provider events must not downgrade a receipt');
assert.match(String(tenantAReceipt?.recipient_hash), /^[a-f0-9]{64}$/);
assert.equal(JSON.stringify(tenantAReceipt).includes('13800000000'), false, 'recipient identifiers must be persisted only as digests');

await Promise.all([
  recordWhatsAppDeliveryStatus({ tenantId: 'tenant-a', providerMessageId: 'wamid.shared', status: 'read', dataStore: store }),
  recordWhatsAppDeliveryStatus({ tenantId: 'tenant-a', providerMessageId: 'wamid.shared', status: 'read', dataStore: store }),
]);
tenantAReceipt = store.all<Receipt>(WHATSAPP_DELIVERY_RECEIPT_COLLECTION)
  .find(record => record.tenant_id === 'tenant-a' && record.provider_message_id === 'wamid.shared');
assert.equal(tenantAReceipt?.status, 'read', 'duplicate concurrent delivery events must converge without throwing');

await registerWhatsAppOutboundMessages({ tenantId: 'tenant-a', operationId, providerMessageIds: ['wamid.second'], dataStore: store });
await recordWhatsAppDeliveryStatus({ tenantId: 'tenant-a', providerMessageId: 'wamid.second', status: 'sent', dataStore: store });
let operation = await store.getById<Record<string, unknown> & { id: string }>(WHATSAPP_OUTBOUND_OPERATION_COLLECTION, operationId);
assert.equal(operation?.delivery_status, 'read', 'a second message must not downgrade the aggregate operation status');

await recordWhatsAppDeliveryStatus({ tenantId: 'tenant-a', providerMessageId: 'wamid.shared', status: 'failed', errorCode: '131047', dataStore: store });
await recordWhatsAppDeliveryStatus({ tenantId: 'tenant-a', providerMessageId: 'wamid.shared', status: 'read', dataStore: store });
tenantAReceipt = store.all<Receipt>(WHATSAPP_DELIVERY_RECEIPT_COLLECTION)
  .find(record => record.tenant_id === 'tenant-a' && record.provider_message_id === 'wamid.shared');
assert.equal(tenantAReceipt?.status, 'failed', 'failure is terminal for a provider message');
operation = await store.getById<Record<string, unknown> & { id: string }>(WHATSAPP_OUTBOUND_OPERATION_COLLECTION, operationId);
assert.equal(operation?.delivery_status, 'failed');

await recordWhatsAppDeliveryStatus({ tenantId: 'tenant-b', providerMessageId: 'wamid.shared', status: 'sent', dataStore: store });
const sharedProviderRecords = store.all<Receipt>(WHATSAPP_DELIVERY_RECEIPT_COLLECTION)
  .filter(record => record.provider_message_id === 'wamid.shared');
assert.equal(sharedProviderRecords.length, 2, 'provider message IDs are unique only inside a tenant boundary');
assert.deepEqual(new Set(sharedProviderRecords.map(record => record.tenant_id)), new Set(['tenant-a', 'tenant-b']));
assert.equal(sharedProviderRecords.find(record => record.tenant_id === 'tenant-b')?.outbound_operation_id || '', '');
await assert.rejects(
  () => registerWhatsAppOutboundMessages({ tenantId: 'tenant-b', operationId, providerMessageIds: ['wamid.cross-tenant'], dataStore: store }),
  /whatsapp_outbound_operation_identity_invalid/,
  'a tenant must not attach delivery receipts to another tenant\'s operation',
);
assert.equal(store.all<Receipt>(WHATSAPP_DELIVERY_RECEIPT_COLLECTION).some(record => record.provider_message_id === 'wamid.cross-tenant'), false);

const earlyOperation = await beginOutboundOperation({
  collection: WHATSAPP_OUTBOUND_OPERATION_COLLECTION,
  tenantId: 'tenant-a',
  idempotencyKey: 'wa:test:tenant-a:operation-early',
  operationType: 'whatsapp_suggestion',
  targetId: 'customer-early',
  payloadHash: outboundPayloadHash({ message: 'early status' }),
  dataStore: store,
});
if (!earlyOperation.ok) throw new Error('early_operation_setup_failed');
await recordWhatsAppDeliveryStatus({ tenantId: 'tenant-a', providerMessageId: 'wamid.early', status: 'delivered', dataStore: store });
await registerWhatsAppOutboundMessages({
  tenantId: 'tenant-a', operationId: earlyOperation.operation.id, providerMessageIds: ['wamid.early'], dataStore: store,
});
const attachedEarlyReceipt = store.all<Receipt>(WHATSAPP_DELIVERY_RECEIPT_COLLECTION)
  .find(record => record.tenant_id === 'tenant-a' && record.provider_message_id === 'wamid.early');
assert.equal(attachedEarlyReceipt?.outbound_operation_id, earlyOperation.operation.id, 'status-before-send races must attach on registration');
assert.equal(
  (await store.getById<Record<string, unknown> & { id: string }>(WHATSAPP_OUTBOUND_OPERATION_COLLECTION, earlyOperation.operation.id))?.delivery_status,
  'delivered',
  'attaching a pre-existing receipt must repair aggregate delivery status',
);
await assert.rejects(
  () => registerWhatsAppOutboundMessages({ tenantId: 'tenant-a', operationId, providerMessageIds: ['wamid.early'], dataStore: store }),
  /whatsapp_provider_message_operation_conflict/,
  'one provider message must never attach to two outbound operations',
);

const tracked = await trackMetaWhatsAppStatuses('tenant-a', {
  entry: [{ changes: [{ value: { statuses: [{
    id: 'wamid.webhook', status: 'delivered', timestamp: '1788307200', recipient_id: '8613900000000',
  }] } }] }],
}, store);
assert.equal(tracked, 1);
const webhookReceipt = store.all<Receipt>(WHATSAPP_DELIVERY_RECEIPT_COLLECTION)
  .find(record => record.provider_message_id === 'wamid.webhook');
assert.equal(webhookReceipt?.status, 'delivered');
assert.equal(JSON.stringify(webhookReceipt).includes('8613900000000'), false);

console.log('WhatsApp delivery tracking is monotonic, idempotent, race-safe, and tenant isolated');
