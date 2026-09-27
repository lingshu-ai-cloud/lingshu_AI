import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { socialAccessToken } from '../lib/accountCredentials.js';
import { store } from '../storage/index.js';
import { sendMessengerText } from '../integrations/messenger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = process.env.MESSENGER_CUSTOMERS_DATA_FILE
  ? path.resolve(process.env.MESSENGER_CUSTOMERS_DATA_FILE)
  : path.join(__dirname, '../../data/messenger-customers.json');

type TimelineEvent = {
  id: string;
  type: 'messenger';
  actor: 'buyer' | 'seller' | 'ai';
  title: string;
  body: string;
  time: string;
  timestamp: number;
  sendStatus?: 'sent' | 'delivered' | 'failed';
  audit?: { providerMessageId?: string; providerRecipientId?: string };
};

export type MessengerCustomer = Record<string, unknown> & {
  id: string;
  tenantId: string;
  pageId: string;
  messengerUserId: string;
  name: string;
  timeline: TimelineEvent[];
  lastActiveAt: number;
};

function readCustomers(): MessengerCustomer[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCustomers(items: MessengerCustomer[]) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const temporary = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(items, null, 2), 'utf8');
  fs.renameSync(temporary, DATA_FILE);
}

function customerId(tenantId: string, pageId: string, userId: string) {
  return `messenger_${createHash('sha256').update(`${tenantId}:${pageId}:${userId}`).digest('hex').slice(0, 20)}`;
}

function initialCustomer(tenantId: string, pageId: string, userId: string, timestamp: number): MessengerCustomer {
  const suffix = userId.slice(-6);
  return {
    id: customerId(tenantId, pageId, userId), tenantId, pageId, messengerUserId: userId,
    name: `Messenger 用户 ${suffix}`, avatar: '', countryName: '未知', language: '待确认', languageLocked: false,
    source: 'messenger', product: '待确认', outboundProduct: '待确认', estimatedValue: '待评估',
    stage: 'inquiry', intentScore: 50, intentSignals: ['Messenger 主动私信'], handlingMode: 'ai_draft',
    handlingReason: '新消息已进入会话，等待回复', hasUnread: true, priority: 50,
    lastActive: '刚刚', lastActiveAt: timestamp, localTime: '--:--', orders: [], tags: ['Messenger'],
    summary: '来自 Messenger 的真实会话。', nextStep: '查看消息并回复', timeline: [],
  };
}

function eventTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function upsertMessage(input: {
  tenantId: string; pageId: string; userId: string; messageId: string; body: string;
  timestamp: number; actor: 'buyer' | 'seller' | 'ai'; sendStatus?: 'sent' | 'delivered';
}) {
  const items = readCustomers();
  const id = customerId(input.tenantId, input.pageId, input.userId);
  const index = items.findIndex(item => item.id === id);
  const customer = index >= 0 ? items[index] : initialCustomer(input.tenantId, input.pageId, input.userId, input.timestamp);
  if (!customer.timeline.some(event => event.id === input.messageId)) {
    customer.timeline.push({
      id: input.messageId, type: 'messenger', actor: input.actor,
      title: input.actor === 'buyer' ? '客户消息' : input.actor === 'ai' ? 'AI 回复' : '我的回复',
      body: input.body, time: eventTime(input.timestamp), timestamp: input.timestamp,
      ...(input.sendStatus ? { sendStatus: input.sendStatus } : {}),
      audit: { providerMessageId: input.messageId, providerRecipientId: input.userId },
    });
  }
  customer.lastActive = '刚刚';
  customer.lastActiveAt = input.timestamp;
  if (input.actor === 'buyer') customer.hasUnread = true;
  items[index >= 0 ? index : items.length] = customer;
  writeCustomers(items);
  return customer;
}

export function getMessengerCustomers(tenantId: string): MessengerCustomer[] {
  return readCustomers()
    .filter(item => item.tenantId === tenantId)
    .sort((left, right) => right.lastActiveAt - left.lastActiveAt);
}

export function patchMessengerCustomer(tenantId: string, id: string, patch: Record<string, unknown>): MessengerCustomer | null {
  const items = readCustomers();
  const index = items.findIndex(item => item.tenantId === tenantId && item.id === id);
  if (index < 0) return null;
  const protectedFields = new Set(['id', 'tenantId', 'pageId', 'messengerUserId', 'timeline']);
  const safePatch = Object.fromEntries(Object.entries(patch).filter(([key]) => !protectedFields.has(key)));
  items[index] = { ...items[index], ...safePatch };
  writeCustomers(items);
  return items[index];
}

export async function handleMessengerWebhook(tenantId: string, payload: unknown) {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  if (root.object !== 'page' || !Array.isArray(root.entry)) return { accepted: 0 };
  let accepted = 0;
  for (const rawEntry of root.entry) {
    const entry = rawEntry && typeof rawEntry === 'object' ? rawEntry as Record<string, unknown> : {};
    const pageId = String(entry.id || '');
    const events = Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const rawEvent of events) {
      const event = rawEvent && typeof rawEvent === 'object' ? rawEvent as Record<string, any> : {};
      const senderId = String(event.sender?.id || '');
      const recipientId = String(event.recipient?.id || '');
      const isEcho = event.message?.is_echo === true;
      const userId = isEcho ? recipientId : senderId;
      const body = String(event.message?.text || event.postback?.title || event.postback?.payload || '').trim();
      if (!pageId || !userId || userId === pageId || !body) continue;
      const timestamp = Number(event.timestamp) || Date.now();
      const messageId = String(event.message?.mid || `messenger_${timestamp}_${userId}`);
      upsertMessage({ tenantId, pageId, userId, messageId, body, timestamp, actor: isEcho ? 'seller' : 'buyer', sendStatus: isEcho ? 'sent' : undefined });
      accepted += 1;
    }
  }
  return { accepted };
}

export async function sendTenantMessengerText(input: { tenantId: string; customerId: string; body: string }) {
  const customer = getMessengerCustomers(input.tenantId).find(item => item.id === input.customerId);
  if (!customer) throw new Error('messenger_customer_not_found');
  const accounts = await store.list<Record<string, unknown>>('social_accounts', {
    where: { tenantId: input.tenantId, platform: 'facebook', status: 'connected' }, page: 1, perPage: 100,
  });
  const account = accounts.items.find(item => String(item.providerAccountId || '') === customer.pageId);
  if (!account) throw new Error('未找到对应的 Facebook Page 授权，请在集成中心重新连接 Messenger。');
  const receipt = await sendMessengerText({
    pageId: customer.pageId,
    pageAccessToken: socialAccessToken(account),
    recipientId: customer.messengerUserId,
    text: input.body,
  });
  if (!receipt.messageId) throw new Error('messenger_provider_message_id_missing');
  upsertMessage({ tenantId: input.tenantId, pageId: customer.pageId, userId: customer.messengerUserId, messageId: receipt.messageId, body: input.body, timestamp: Date.now(), actor: 'seller', sendStatus: 'sent' });
  return receipt;
}
