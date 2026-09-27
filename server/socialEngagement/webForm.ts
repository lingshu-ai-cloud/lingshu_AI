import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import { decryptSecret, encryptSecret } from '../lib/tenantPlatformApps.js';
import { writebackInteraction, type StoredInteractionWriteback } from './writeback.js';

export const WEB_FORM_SOURCES = 'social_engagement_sources';
export const WEB_FORM_RECEIPTS = 'social_engagement_webhook_receipts';

export interface WebFormSourceRecord {
  id: string;
  tenant_id: string;
  source_id: string;
  platform: 'web_form';
  account_id: string;
  label: string;
  signing_secret: string;
  status: 'active' | 'revoked';
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface WebFormReceiptRecord {
  id: string;
  tenant_id: string;
  source_id: string;
  provider_event_id: string;
  payload_hash: string;
  interaction_id: string;
  received_minute: string;
  received_at: string;
}

const text = (value: unknown, max = 500): string => String(value ?? '').trim().slice(0, max);

export function verifyWebFormSignature(secret: string, rawBody: Buffer, signatureHeader: unknown): boolean {
  const signature = text(Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader, 80).toLowerCase();
  if (!secret || !Buffer.isBuffer(rawBody) || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function createWebFormSource(input: {
  tenantId: string;
  userId: string;
  accountId: string;
  label: string;
  sourceId?: string;
  now?: Date;
  dataStore?: DataStore;
}): Promise<{ source: Omit<WebFormSourceRecord, 'signing_secret'>; signingSecret: string }> {
  const dataStore = input.dataStore ?? store;
  const accountId = text(input.accountId, 200);
  const label = text(input.label, 200);
  if (!accountId || !label) throw new Error('web_form_source_fields_required');
  const sourceId = text(input.sourceId, 200) || `form_${randomUUID().replaceAll('-', '')}`;
  if (!/^[a-z0-9:_-]{8,200}$/i.test(sourceId)) throw new Error('web_form_source_id_invalid');
  const existing = await dataStore.list<WebFormSourceRecord>(WEB_FORM_SOURCES, { where: { source_id: sourceId }, page: 1, perPage: 2 });
  if (existing.totalItems || existing.items.length) throw new Error('web_form_source_id_conflict');
  const signingSecret = randomBytes(32).toString('base64url');
  const now = (input.now ?? new Date()).toISOString();
  const created = await dataStore.create<WebFormSourceRecord>(WEB_FORM_SOURCES, {
    tenant_id: input.tenantId, source_id: sourceId, platform: 'web_form', account_id: accountId,
    label, signing_secret: encryptSecret(signingSecret), status: 'active', created_by: input.userId,
    created_at: now, updated_at: now,
  });
  if (!created) throw new Error('web_form_source_storage_unavailable');
  const { signing_secret: _secret, ...source } = created;
  return { source, signingSecret };
}

export async function listWebFormSources(tenantId: string, dataStore: DataStore = store) {
  const result = await dataStore.list<WebFormSourceRecord>(WEB_FORM_SOURCES, {
    where: { tenant_id: tenantId, platform: 'web_form' }, sort: '-created_at', page: 1, perPage: 100,
  });
  return result.items.map(({ signing_secret: _secret, ...item }) => item);
}

export async function revokeWebFormSource(input: {
  tenantId: string; sourceId: string; now?: Date; dataStore?: DataStore;
}): Promise<boolean> {
  const dataStore = input.dataStore ?? store;
  const result = await dataStore.list<WebFormSourceRecord>(WEB_FORM_SOURCES, {
    where: { tenant_id: input.tenantId, source_id: input.sourceId }, page: 1, perPage: 2,
  });
  if (result.totalItems !== 1 || !result.items[0]) return false;
  return dataStore.update(WEB_FORM_SOURCES, result.items[0].id, { status: 'revoked', signing_secret: '', updated_at: (input.now ?? new Date()).toISOString() });
}

export async function ingestSignedWebForm(input: {
  sourceId: string;
  rawBody: Buffer;
  signature: unknown;
  body: unknown;
  now?: Date;
  perMinuteLimit?: number;
  dataStore?: DataStore;
}): Promise<{ item: StoredInteractionWriteback; repeated: boolean; tenantId: string }> {
  const dataStore = input.dataStore ?? store;
  const sources = await dataStore.list<WebFormSourceRecord>(WEB_FORM_SOURCES, {
    where: { source_id: text(input.sourceId, 200), platform: 'web_form' }, page: 1, perPage: 2,
  });
  if (sources.totalItems !== 1 || !sources.items[0] || sources.items[0].status !== 'active') throw new Error('web_form_source_not_found');
  const source = sources.items[0];
  const secret = decryptSecret(source.signing_secret);
  if (!verifyWebFormSignature(secret, input.rawBody, input.signature)) throw new Error('web_form_signature_invalid');
  const body = input.body && typeof input.body === 'object' && !Array.isArray(input.body) ? input.body as Record<string, unknown> : {};
  const providerEventId = text(body.eventId ?? body.providerEventId, 300);
  const message = text(body.message ?? body.body, 10_000);
  const occurredAt = text(body.occurredAt, 100);
  if (!providerEventId || !message || !Number.isFinite(Date.parse(occurredAt))) throw new Error('web_form_event_invalid');
  const payloadHash = createHash('sha256').update(input.rawBody).digest('hex');
  const existing = await dataStore.list<WebFormReceiptRecord>(WEB_FORM_RECEIPTS, {
    where: { tenant_id: source.tenant_id, source_id: source.source_id, provider_event_id: providerEventId }, page: 1, perPage: 2,
  });
  if (existing.totalItems > 1 || existing.items.length > 1) throw new Error('web_form_receipt_integrity_violation');
  if (existing.items[0]) {
    if (existing.items[0].payload_hash !== payloadHash) throw new Error('web_form_event_conflict');
    const item = await dataStore.getById<StoredInteractionWriteback>('social_interaction_writebacks', existing.items[0].interaction_id);
    if (!item || item.tenant_id !== source.tenant_id) throw new Error('web_form_receipt_integrity_violation');
    return { item, repeated: true, tenantId: source.tenant_id };
  }
  const now = input.now ?? new Date();
  const minute = now.toISOString().slice(0, 16);
  const limit = Math.min(Math.max(input.perMinuteLimit ?? 120, 1), 1_000);
  const recent = await dataStore.list<WebFormReceiptRecord>(WEB_FORM_RECEIPTS, {
    where: { tenant_id: source.tenant_id, source_id: source.source_id, received_minute: minute }, page: 1, perPage: 1,
  });
  if (recent.totalItems >= limit) throw new Error('web_form_rate_limit_exceeded');
  const result = await writebackInteraction(source.tenant_id, {
    kind: 'form', platform: 'web_form', providerEventId, accountId: source.account_id,
    body: message, occurredAt, actorRef: text(body.actorRef, 300) || undefined,
    entryRef: text(body.entryRef, 500) || source.source_id,
    ctaRef: text(body.ctaRef, 300) || undefined,
    businessDirectionRef: text(body.businessDirectionRef, 300) || undefined,
    qualificationFields: body.qualificationFields,
    raw: body,
  }, dataStore);
  const receipt = await dataStore.create<WebFormReceiptRecord>(WEB_FORM_RECEIPTS, {
    tenant_id: source.tenant_id, source_id: source.source_id, provider_event_id: providerEventId,
    payload_hash: payloadHash, interaction_id: result.item.id, received_minute: minute, received_at: now.toISOString(),
  });
  if (!receipt) {
    const raced = await dataStore.list<WebFormReceiptRecord>(WEB_FORM_RECEIPTS, {
      where: { tenant_id: source.tenant_id, source_id: source.source_id, provider_event_id: providerEventId }, page: 1, perPage: 1,
    });
    if (!raced.items[0] || raced.items[0].payload_hash !== payloadHash) throw new Error('web_form_receipt_storage_unavailable');
    return { item: result.item, repeated: true, tenantId: source.tenant_id };
  }
  return { item: result.item, repeated: result.repeated, tenantId: source.tenant_id };
}
