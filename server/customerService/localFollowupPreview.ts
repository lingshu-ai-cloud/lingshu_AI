import { createHash } from 'node:crypto';
import { store, type DataStore, type Record_ } from '../storage/index.js';

/** Explicitly selected local copies, never native-channel identities or receipts. */
export function localFollowupPreviewEnabled(tenantId: string) {
  return process.env.NODE_ENV === 'development'
    && process.env.LINGSHU_LISTEN_HOST === '127.0.0.1'
    && process.env.LOCAL_FOLLOWUP_PREVIEW_TENANT_ID === tenantId
    && Boolean(tenantId);
}
const collection = 'whatsapp_customers';
const recordId = (tenant: string, customer: string) => createHash('sha256').update(`local-followup:${tenant}:${customer}`).digest('hex').slice(0, 15);
const object = (value: unknown): Record<string, unknown> => {
  if (typeof value === 'string') { try { return object(JSON.parse(value)); } catch { return {}; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
};
function project(row: Record_, tenantId: string) {
  const p = object(row.payload);
  if (row.tenant_id !== tenantId || p.tenantId !== tenantId || p.localFollowupPreview !== true
    || typeof p.id !== 'string' || !p.id.startsWith('preview_followup_')
    || row.customer_id !== p.id || row.id !== recordId(tenantId, p.id)) return null;
  return { ...p, id: p.id, tenantId, localFollowupPreview: true, source: 'local_followup',
    isMock: true, isReal: false, isHistorical: false, readOnly: false, outboundBlocked: false,
    timeline: Array.isArray(p.timeline) ? p.timeline.map(object) : [] };
}
export async function readLocalFollowupPreviewCustomers(tenantId: string, dataStore: DataStore = store) {
  if (!localFollowupPreviewEnabled(tenantId)) return [];
  const result = await dataStore.list<Record_>(collection, { where: { tenant_id: tenantId }, perPage: 1000 });
  if (result.totalItems !== result.items.length) throw Error('local_followup_preview_scope_incomplete');
  return result.items.map(row => project(row, tenantId)).filter((row): row is NonNullable<typeof row> => row !== null);
}
export async function appendLocalFollowupPreviewMessage(tenantId: string, customerId: string, body: string, requestId: string, dataStore: DataStore = store) {
  if (!localFollowupPreviewEnabled(tenantId) || !customerId.startsWith('preview_followup_')) return null;
  const id = recordId(tenantId, customerId), row = await dataStore.getById<Record_>(collection, id);
  const customer = row && project(row, tenantId);
  if (!customer) throw Error('local_followup_preview_customer_not_found');
  const prior = customer.timeline.find(t => t.sendRequestId === requestId && t.localPreviewReceipt === true);
  if (prior) {
    if (prior.body !== body) throw Error('local_followup_preview_request_conflict');
    return prior;
  }
  const timestamp = Date.now();
  const event = { id: `local-followup-${requestId}`, type: 'whatsapp', actor: 'seller', title: '本地演练回复',
    body, timestamp, time: new Date(timestamp).toISOString(), sendRequestId: requestId,
    sendStatus: 'sent', localPreviewReceipt: true, confirmedByHuman: true };
  const payload = { ...customer, timeline: [...customer.timeline, event], hasUnread: false, pendingDraft: null,
    lastActiveAt: timestamp, todoCompletedAt: new Date(timestamp).toISOString() };
  if (!await dataStore.update(collection, id, { payload: JSON.stringify(payload), last_active_at: timestamp })) throw Error('local_followup_preview_save_failed');
  return event;
}
export async function saveLocalFollowupPreviewDraft(tenantId: string, customerId: string, pendingDraft: string | null, dataStore: DataStore = store) {
  if (!localFollowupPreviewEnabled(tenantId) || !customerId.startsWith('preview_followup_')) return false;
  const id = recordId(tenantId, customerId), row = await dataStore.getById<Record_>(collection, id);
  const customer = row && project(row, tenantId);
  if (!customer) return false;
  if (!await dataStore.update(collection, id, { payload: JSON.stringify({ ...customer, pendingDraft }) })) throw Error('local_followup_preview_save_failed');
  return true;
}
