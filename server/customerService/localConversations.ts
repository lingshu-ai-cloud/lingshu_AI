import fs from 'node:fs';
import path from 'node:path';
import { createForeignTradeMockCustomers } from '../../src/mocks/foreignTradeCustomerProfiles.js';

const CUSTOMERS_FILE = path.resolve(process.cwd(), 'data/whatsapp-customers.json');
const INTERACTIONS_FILE = path.resolve(process.cwd(), 'data/whatsapp-interactions.json');
const readArray = (file: string): Array<Record<string, unknown>> => {
  try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(value) ? value : []; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
};

type LocalCustomerConversation = Record<string, unknown> & {
  id: string;
  name: string;
  stage: string;
  intentScore: number;
  pendingDraft?: unknown;
  lastActiveAt: number;
  timeline: Array<{ id: string; type: string; actor: string; body: string; timestamp: number; translatedBody?: string }>;
  hasUnread: boolean;
  isMock: boolean;
};

function previewTenantId() {
  return String(process.env.LINGSHU_PREVIEW_CONVERSATION_TENANT_ID || 'local_tenant_customer_aurelia_beauty').trim();
}

function previewCustomers(tenantId: string): Array<Record<string, unknown>> {
  if (process.env.LINGSHU_LOCAL_PREVIEW !== '1' || tenantId !== previewTenantId()) return [];
  return createForeignTradeMockCustomers().map(customer => ({
    ...customer,
    tenantId,
    localPreview: true,
  }));
}

function localCustomers(tenantId: string, file: string) {
  const byId = new Map<string, Record<string, unknown>>();
  for (const customer of [...previewCustomers(tenantId), ...readArray(file)]) {
    if (customer.tenantId !== tenantId || typeof customer.id !== 'string') continue;
    byId.set(customer.id, customer);
  }
  return [...byId.values()];
}

function writableLocalPreviewCustomer(customer: Record<string, unknown>) {
  const id = String(customer.id || '');
  if (id.startsWith('wa_mock_')) return true;
  return process.env.LINGSHU_LOCAL_PREVIEW === '1'
    && customer.localPreview === true
    && (id.startsWith('mock-export-') || id === 'mock-free-sandbox');
}

function conversationEvent(item: Record<string, unknown>, index: number) {
  const type = String(item.type || 'whatsapp');
  const actor = item.actor === 'buyer' || type === 'msg_in'
    ? 'buyer'
    : item.actor === 'ai' || type === 'msg_out_ai'
      ? 'ai'
      : item.actor === 'owner' || type === 'system'
        ? 'owner'
        : 'seller';
  return {
    id: String(item.id || `local-message-${index}`),
    type,
    actor,
    body: String(item.body || ''),
    timestamp: Number(item.timestamp || 0),
    ...(typeof item.translatedBody === 'string' ? { translatedBody: item.translatedBody } : {}),
  };
}

export function appendLocalCustomerMessage(tenantId: string, customerId: string, body: string, requestId: string, files = { customers: CUSTOMERS_FILE, interactions: INTERACTIONS_FILE }) {
  const customers = readArray(files.customers);
  const customer = localCustomers(tenantId, files.customers).find(item => item.id === customerId);
  if (!customer || !writableLocalPreviewCustomer(customer)) return null;
  const interactions = readArray(files.interactions);
  const existing = interactions.find(item => item.tenantId === tenantId && item.customerId === customerId && item.requestId === requestId);
  if (existing) return existing;
  const timestamp = Date.now();
  const item = { id: `local-out-${requestId}`, tenantId, customerId, waNumber: customer.waNumber,
    type: 'msg_out_human', body, timestamp, requestId, localPreview: true };
  interactions.push(item);
  fs.writeFileSync(files.interactions, JSON.stringify(interactions, null, 2) + '\n', 'utf8');
  const storedCustomer = customers.find(candidate => candidate.tenantId === tenantId && candidate.id === customerId);
  if (storedCustomer) {
    storedCustomer.lastActiveAt = timestamp;
    storedCustomer.updatedAt = new Date(timestamp).toISOString();
    storedCustomer.hasUnread = false;
    fs.writeFileSync(files.customers, JSON.stringify(customers, null, 2) + '\n', 'utf8');
  }
  return item;
}

export function readLocalCustomerConversations(tenantId: string, files = { customers: CUSTOMERS_FILE, interactions: INTERACTIONS_FILE }): LocalCustomerConversation[] {
  if (!tenantId.trim()) return [];
  const interactions = readArray(files.interactions).filter(item => item.tenantId === tenantId);
  return localCustomers(tenantId, files.customers).map(customer => {
    const baseTimeline = Array.isArray(customer.timeline)
      ? customer.timeline.filter(item => item && typeof item === 'object').map((item, index) => conversationEvent(item as Record<string, unknown>, index))
      : [];
    const appendedTimeline = interactions.filter(item => item.customerId === customer.id).map((item, index) => conversationEvent(item, baseTimeline.length + index));
    const timeline = [...new Map([...baseTimeline, ...appendedTimeline].map(item => [item.id, item])).values()]
      .sort((a, b) => a.timestamp - b.timestamp);
    const lastAppended = appendedTimeline.sort((a, b) => a.timestamp - b.timestamp).at(-1);
    const writable = writableLocalPreviewCustomer(customer);
    return {
      ...customer,
      id: String(customer.id),
      name: String(customer.name || customer.waName || customer.waNumber || customer.id),
      stage: String(customer.stage || 'new'),
      intentScore: Number(customer.intentScore || 0),
      pendingDraft: customer.pendingDraft,
      lastActiveAt: Number(customer.lastActiveAt || timeline.at(-1)?.timestamp || 0),
      source: 'whatsapp_local', channel: 'WhatsApp', timeline,
      hasUnread: lastAppended ? lastAppended.actor === 'buyer' : typeof customer.hasUnread === 'boolean' ? customer.hasUnread : timeline.at(-1)?.actor === 'buyer',
      isLocal: true, isMock: writable, readOnly: !writable, outboundBlocked: !writable,
    };
  });
}

export function summarizeLocalCustomerConversations(items: ReturnType<typeof readLocalCustomerConversations>) {
  return items.map(item => ({ id: item.id, name: item.name, stage: item.stage, intentScore: item.intentScore,
    pendingDraft: item.pendingDraft, hasUnread: item.hasUnread, lastActiveAt: item.lastActiveAt,
    latestMessage: item.timeline.at(-1)?.body || '', messageCount: item.timeline.length, isMock: item.isMock }));
}
