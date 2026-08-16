import { sanitizeStyleText } from './styleMemory.js';
import { store } from '../storage/index.js';

export const CUSTOMER_MEMORY_COLLECTION = 'customer_memory';

export type CustomerMemoryStatus = 'pending' | 'confirmed' | 'paused' | 'superseded' | 'conflict';
export type CustomerMemorySource = 'human' | 'ai_inferred';

export interface CustomerMemoryRecord {
  id: string;
  tenant_id: string;
  customer_id: string;
  memory_key: string;
  memory_value: string;
  evidence?: string;
  status?: CustomerMemoryStatus;
  source_kind?: CustomerMemorySource;
  confidence?: number | string;
  expires_at?: string;
  conflict_with?: string;
  superseded_by?: string;
  created_by?: string;
  confirmed_by?: string;
  confirmed_at?: string;
  updated_by?: string;
  created?: string;
  updated?: string;
}

const KEY_LABELS: Record<string, string> = {
  preferred_language: '沟通语言偏好',
  preferred_tone: '沟通语气偏好',
  preferred_channel: '联系渠道偏好',
  communication_preference: '沟通方式偏好',
  product_preference: '产品偏好',
  buying_context: '采购背景',
  schedule_preference: '联系时间偏好',
  other: '其他客户私有偏好',
};

const FORBIDDEN_SHARED_FACT_KEY = /(price|pricing|discount|moq|stock|inventory|lead.?time|delivery|certificate|certification|payment|refund|compensation|exclusive|legal|compliance|价格|折扣|起订|库存|交期|认证|付款|退款|赔偿|独家|合规)/i;

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function status(record: CustomerMemoryRecord): CustomerMemoryStatus {
  return record.status || 'pending';
}

function timestamp(record: CustomerMemoryRecord): number {
  const value = Date.parse(record.updated || record.created || '');
  return Number.isFinite(value) ? value : 0;
}

export function customerMemoryKeyAllowed(value: unknown): boolean {
  const key = text(value).slice(0, 80);
  return Boolean(KEY_LABELS[key]) && !FORBIDDEN_SHARED_FACT_KEY.test(key);
}

export function customerMemoryToClient(record: CustomerMemoryRecord) {
  return {
    id: record.id,
    customerId: text(record.customer_id),
    key: text(record.memory_key),
    keyLabel: KEY_LABELS[text(record.memory_key)] || text(record.memory_key),
    value: sanitizeStyleText(record.memory_value),
    evidence: sanitizeStyleText(record.evidence),
    status: status(record),
    sourceKind: record.source_kind === 'ai_inferred' ? 'ai_inferred' : 'human',
    confidence: Math.max(0, Math.min(1, Number(record.confidence || 0))),
    expiresAt: text(record.expires_at),
    conflictWith: text(record.conflict_with),
    supersededBy: text(record.superseded_by),
    confirmedAt: text(record.confirmed_at),
    created: text(record.created),
    updated: text(record.updated),
  };
}

export async function listCustomerMemories(tenantId: string, customerId = ''): Promise<CustomerMemoryRecord[]> {
  const items: CustomerMemoryRecord[] = [];
  for (let page = 1; items.length < 10_000; page += 1) {
    const result = await store.list<CustomerMemoryRecord>(CUSTOMER_MEMORY_COLLECTION, {
      where: customerId ? { tenant_id: tenantId, customer_id: customerId } : { tenant_id: tenantId },
      sort: '-updated', page, perPage: 500,
    });
    items.push(...result.items);
    if (page >= result.totalPages || result.items.length === 0) break;
  }
  return items;
}

export function resolveActiveCustomerMemories(records: CustomerMemoryRecord[], now = Date.now()): CustomerMemoryRecord[] {
  const usable = records.filter(record => {
    if (status(record) !== 'confirmed') return false;
    const expiry = Date.parse(record.expires_at || '');
    return !Number.isFinite(expiry) || expiry > now;
  });
  const byKey = new Map<string, CustomerMemoryRecord>();
  for (const record of usable.sort((a, b) => {
    const humanDelta = Number(b.source_kind === 'human') - Number(a.source_kind === 'human');
    return humanDelta || timestamp(b) - timestamp(a);
  })) {
    if (!byKey.has(record.memory_key)) byKey.set(record.memory_key, record);
  }
  return [...byKey.values()].slice(0, 20);
}

export async function retrieveCustomerMemories(tenantId: string, customerId: string): Promise<CustomerMemoryRecord[]> {
  if (!tenantId || !customerId) return [];
  return resolveActiveCustomerMemories(await listCustomerMemories(tenantId, customerId));
}

export function buildCustomerMemoryPromptBlock(records: CustomerMemoryRecord[]): string {
  if (!records.length) return '';
  return [
    'Confirmed private memory for this customer only:',
    'These records may describe the buyer preference or context. Never reuse them for another customer.',
    'They are not enterprise facts and never authorize price, MOQ, inventory, delivery time, certification, payment, discount, compensation, or legal claims.',
    'Prefer the newer human-confirmed record when anything conflicts. Do not repeat a question that these records already answer.',
    ...records.map(record => `- ${KEY_LABELS[record.memory_key] || record.memory_key}: ${sanitizeStyleText(record.memory_value)}`),
  ].join('\n');
}

export async function createCustomerMemory(input: {
  tenantId: string;
  customerId: string;
  key: string;
  value: string;
  evidence?: string;
  sourceKind: CustomerMemorySource;
  status: CustomerMemoryStatus;
  confidence?: number;
  expiresAt?: string;
  actorUserId: string;
}): Promise<CustomerMemoryRecord | null> {
  const key = text(input.key).slice(0, 80);
  if (!customerMemoryKeyAllowed(key)) throw new Error('customer_memory_key_not_allowed');
  const value = sanitizeStyleText(input.value).slice(0, 1000);
  if (!input.tenantId || !input.customerId || !value) throw new Error('customer_memory_required_fields');
  if (input.expiresAt && !Number.isFinite(Date.parse(input.expiresAt))) throw new Error('invalid_customer_memory_expiry');
  const siblings = (await listCustomerMemories(input.tenantId, input.customerId)).filter(record => record.memory_key === key);
  const humanConfirmed = siblings.find(record => status(record) === 'confirmed' && record.source_kind === 'human');
  let nextStatus = input.status;
  let conflictWith = '';
  if (input.sourceKind === 'ai_inferred' && humanConfirmed) {
    nextStatus = 'conflict';
    conflictWith = humanConfirmed.id;
  }
  const payload: Record<string, unknown> = {
    tenant_id: input.tenantId,
    customer_id: input.customerId,
    memory_key: key,
    memory_value: value,
    evidence: sanitizeStyleText(input.evidence).slice(0, 1000),
    status: nextStatus,
    source_kind: input.sourceKind,
    confidence: Math.max(0, Math.min(1, Number(input.confidence ?? (input.sourceKind === 'human' ? 1 : 0.5)))),
    conflict_with: conflictWith,
    created_by: input.actorUserId,
    updated_by: input.actorUserId,
  };
  if (input.expiresAt) payload.expires_at = input.expiresAt;
  if (nextStatus === 'confirmed') {
    payload.confirmed_by = input.actorUserId;
    payload.confirmed_at = new Date().toISOString();
  }
  const created = await store.create<CustomerMemoryRecord>(CUSTOMER_MEMORY_COLLECTION, payload);
  if (created && nextStatus === 'confirmed' && input.sourceKind === 'human') {
    await Promise.all(siblings
      .filter(record => status(record) === 'confirmed')
      .map(record => store.update(CUSTOMER_MEMORY_COLLECTION, record.id, {
        status: 'superseded',
        superseded_by: created.id,
        updated_by: input.actorUserId,
      })));
  }
  return created;
}
