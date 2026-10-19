import fs from 'node:fs';
import path from 'node:path';

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
  timeline: Array<{ id: string; type: string; actor: string; body: string; timestamp: number }>;
  hasUnread: boolean;
  isMock: boolean;
};

export function appendLocalCustomerMessage(tenantId: string, customerId: string, body: string, requestId: string, files = { customers: CUSTOMERS_FILE, interactions: INTERACTIONS_FILE }) {
  const customers = readArray(files.customers);
  const customer = customers.find(item => item.tenantId === tenantId && item.id === customerId);
  if (!customer || !String(customer.id || '').startsWith('wa_mock_')) return null;
  const interactions = readArray(files.interactions);
  const existing = interactions.find(item => item.tenantId === tenantId && item.customerId === customerId && item.requestId === requestId);
  if (existing) return existing;
  const timestamp = Date.now();
  const item = { id: `local-out-${requestId}`, tenantId, customerId, waNumber: customer.waNumber,
    type: 'msg_out_human', body, timestamp, requestId, localPreview: true };
  interactions.push(item);
  fs.writeFileSync(files.interactions, JSON.stringify(interactions, null, 2) + '\n', 'utf8');
  customer.lastActiveAt = timestamp; customer.updatedAt = new Date(timestamp).toISOString(); customer.hasUnread = false;
  fs.writeFileSync(files.customers, JSON.stringify(customers, null, 2) + '\n', 'utf8');
  return item;
}

export function readLocalCustomerConversations(tenantId: string, files = { customers: CUSTOMERS_FILE, interactions: INTERACTIONS_FILE }): LocalCustomerConversation[] {
  if (!tenantId.trim()) return [];
  const interactions = readArray(files.interactions).filter(item => item.tenantId === tenantId);
  return readArray(files.customers).filter(item => item.tenantId === tenantId && typeof item.id === 'string').map(customer => {
    const timeline = interactions.filter(item => item.customerId === customer.id).sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0)).map(item => ({
      id: String(item.id || ''), type: String(item.type || 'whatsapp'),
      actor: item.type === 'msg_in' ? 'buyer' : item.type === 'msg_out_ai' ? 'ai' : item.type === 'system' ? 'owner' : 'seller',
      body: String(item.body || ''), timestamp: Number(item.timestamp || 0),
    }));
    return {
      ...customer,
      id: String(customer.id),
      name: String(customer.name || customer.waName || customer.waNumber || customer.id),
      stage: String(customer.stage || 'new'),
      intentScore: Number(customer.intentScore || 0),
      pendingDraft: customer.pendingDraft,
      lastActiveAt: Number(customer.lastActiveAt || timeline.at(-1)?.timestamp || 0),
      source: 'whatsapp_local', channel: 'WhatsApp', timeline,
      hasUnread: typeof customer.hasUnread === 'boolean' ? customer.hasUnread : timeline.at(-1)?.actor === 'buyer',
      isLocal: true, isMock: String(customer.id).startsWith('wa_mock_'), readOnly: !String(customer.id).startsWith('wa_mock_'), outboundBlocked: !String(customer.id).startsWith('wa_mock_'),
    };
  });
}

export function summarizeLocalCustomerConversations(items: ReturnType<typeof readLocalCustomerConversations>) {
  return items.map(item => ({ id: item.id, name: item.name, stage: item.stage, intentScore: item.intentScore,
    pendingDraft: item.pendingDraft, hasUnread: item.hasUnread, lastActiveAt: item.lastActiveAt,
    latestMessage: item.timeline.at(-1)?.body || '', messageCount: item.timeline.length, isMock: item.isMock }));
}
