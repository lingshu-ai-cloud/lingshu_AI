import { createHash, randomBytes } from 'node:crypto';
import { Router, json } from 'express';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { enforceSupportSessionReadOnly, type AuthLocals } from '../middleware/auth.js';

export const MOBILE_ASSISTANT_SESSIONS = 'assistant_threads';
export const MOBILE_ASSISTANT_MESSAGES = 'mobile_assistant_messages';
export interface MobileAssistantIdentity { tenantId: string; userId: string }
export interface MobileAssistantMessageInput {
  role: 'user' | 'assistant'; text: string; clientMessageId: string; commandId?: string;
}
const identifier = /^[A-Za-z0-9:_-]{1,128}$/;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function visibleMessage(row: Record_) {
  return { id: row.id, role: row.role, text: row.text, commandId: row.command_id || null, createdAt: row.created_at, clientMessageId: row.client_message_id };
}
function visibleSession(row: Record_) {
  return { id: row.id, title: row.title, createdAt: row.createdAt };
}
async function ownedSession(store: DataStore, identity: MobileAssistantIdentity, id: string) {
  if (!identifier.test(id)) return null;
  const row = await store.getById<Record_>(MOBILE_ASSISTANT_SESSIONS, id);
  return row?.tenantId === identity.tenantId && row?.userId === identity.userId && row?.source === 'mobile_workbench' ? row : null;
}
export class MobileAssistantSessionError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
export async function findMobileAssistantMessage(store: DataStore, identity: MobileAssistantIdentity, sessionId: string, clientMessageId: string) {
  if (!await ownedSession(store, identity, sessionId)) throw new MobileAssistantSessionError(404, 'mobile_assistant_session_not_found');
  if (typeof clientMessageId !== 'string' || !identifier.test(clientMessageId)) throw new MobileAssistantSessionError(400, 'mobile_assistant_message_invalid');
  const id = digest([identity.tenantId, identity.userId, sessionId, clientMessageId]).slice(0, 24);
  const row = await store.getById<Record_>(MOBILE_ASSISTANT_MESSAGES, id);
  return row?.tenant_id === identity.tenantId && row?.user_id === identity.userId && row?.session_id === sessionId ? visibleMessage(row) : null;
}
/** Server-only writer. Client routes may append user messages only; assistant results come from trusted orchestration. */
export async function appendMobileAssistantMessage(store: DataStore, identity: MobileAssistantIdentity, sessionId: string, input: MobileAssistantMessageInput) {
  if (!await ownedSession(store, identity, sessionId)) throw new MobileAssistantSessionError(404, 'mobile_assistant_session_not_found');
  if (!['user', 'assistant'].includes(input.role) || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 12000
    || typeof input.clientMessageId !== 'string' || !identifier.test(input.clientMessageId) || (input.commandId !== undefined && (typeof input.commandId !== 'string' || !identifier.test(input.commandId)))) {
    throw new MobileAssistantSessionError(400, 'mobile_assistant_message_invalid');
  }
  if (input.commandId) {
    const receipt = await store.getById<Record_>('mobile_workbench_action_receipts', input.commandId);
    if (receipt?.tenant_id !== identity.tenantId || receipt?.user_id !== identity.userId) throw new MobileAssistantSessionError(404, 'mobile_assistant_command_not_found');
  }
  const data = { role: input.role, text: input.text.trim(), command_id: input.commandId || '' };
  const id = digest([identity.tenantId, identity.userId, sessionId, input.clientMessageId]).slice(0, 24);
  const requestHash = digest(data);
  const existing = await store.getById<Record_>(MOBILE_ASSISTANT_MESSAGES, id);
  if (existing) {
    if (existing.tenant_id !== identity.tenantId || existing.user_id !== identity.userId || existing.session_id !== sessionId || existing.request_hash !== requestHash) {
      throw new MobileAssistantSessionError(409, 'mobile_assistant_message_conflict');
    }
    return { message: visibleMessage(existing), replayed: true };
  }
  const record = { id, tenant_id: identity.tenantId, user_id: identity.userId, session_id: sessionId,
    ...data, client_message_id: input.clientMessageId, request_hash: requestHash, created_at: new Date().toISOString() };
  let saved: Record_ | null;
  try { saved = await store.create<Record_>(MOBILE_ASSISTANT_MESSAGES, record); }
  catch (error) {
    // A concurrent identical retry may have won the unique insert.
    const winner = await store.getById<Record_>(MOBILE_ASSISTANT_MESSAGES, id);
    if (!winner) throw error;
    if (winner.tenant_id !== identity.tenantId || winner.user_id !== identity.userId || winner.session_id !== sessionId || winner.request_hash !== requestHash) {
      throw new MobileAssistantSessionError(409, 'mobile_assistant_message_conflict');
    }
    return { message: visibleMessage(winner), replayed: true };
  }
  if (!saved) throw new MobileAssistantSessionError(503, 'mobile_assistant_storage_unavailable');
  return { message: visibleMessage(saved), replayed: false };
}
function pageOf(value: unknown) { const n = Number(value ?? 1); return Number.isInteger(n) && n >= 1 && n <= 10000 ? n : null; }
export function createMobileAssistantSessionsRouter(store: DataStore) {
  const router = Router();
  router.use(enforceSupportSessionReadOnly, (req, res, next) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    if (!tenantId || !userId) { res.status(401).json({ error: 'unauthorized' }); return; }
    res.setHeader('Cache-Control', 'private, no-store'); next();
  });
  router.get('/assistant/sessions', async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const page = pageOf(req.query.page);
    if (!page) { res.status(400).json({ error: 'mobile_assistant_page_invalid' }); return; }
    try {
      const list = await store.list<Record_>(MOBILE_ASSISTANT_SESSIONS, { where: { tenantId, userId, source: 'mobile_workbench' }, sort: '-createdAt', page, perPage: 30 });
      res.json({ sessions: list.items.filter(row => row.tenantId === tenantId && row.userId === userId && row.source === 'mobile_workbench').map(visibleSession), page, totalPages: list.totalPages });
    } catch { res.status(503).json({ error: 'mobile_assistant_storage_unavailable' }); }
  });
  router.post('/assistant/sessions', json({ limit: '4kb' }), async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const title = req.body?.title ?? '新对话';
    if (typeof title !== 'string' || !title.trim() || title.length > 100 || Object.keys(req.body ?? {}).some(key => key !== 'title')) {
      res.status(400).json({ error: 'mobile_assistant_session_invalid' }); return;
    }
    try {
      const row = await store.create<Record_>(MOBILE_ASSISTANT_SESSIONS, { id: randomBytes(8).toString('hex').slice(0, 15), tenantId, userId, agentId: 'mobile_workbench', source: 'mobile_workbench', title: title.trim(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [] });
      if (!row) throw new Error('storage');
      res.status(201).json({ session: visibleSession(row) });
    } catch { res.status(503).json({ error: 'mobile_assistant_storage_unavailable' }); }
  });
  router.get('/assistant/sessions/:id/messages', async (req, res) => {
    const identity = res.locals as AuthLocals;
    const page = pageOf(req.query.page);
    if (!page) { res.status(400).json({ error: 'mobile_assistant_page_invalid' }); return; }
    try {
      const session = await ownedSession(store, identity, String(req.params.id));
      if (!session) { res.status(404).json({ error: 'mobile_assistant_session_not_found' }); return; }
      const list = await store.list<Record_>(MOBILE_ASSISTANT_MESSAGES, { where: { tenant_id: identity.tenantId, user_id: identity.userId, session_id: session.id }, sort: '-created_at', page, perPage: 50 });
      // Newest page first, but messages within the page in conversational order.
      const rows = list.items.filter(row => row.tenant_id === identity.tenantId && row.user_id === identity.userId && row.session_id === session.id).reverse();
      const receipts = [];
      for (const commandId of new Set(rows.map(row => row.command_id).filter(value => typeof value === 'string' && value))) {
        const receipt = await store.getById<Record_>('mobile_workbench_action_receipts', String(commandId));
        if (receipt?.tenant_id === identity.tenantId && receipt?.user_id === identity.userId) receipts.push({ id: receipt.id, status: receipt.status, kind: receipt.kind, targetId: receipt.target_id, result: receipt.result || null, error: receipt.error || null });
      }
      res.json({ session: visibleSession(session), messages: rows.map(visibleMessage), receipts, page, totalPages: list.totalPages });
    } catch { res.status(503).json({ error: 'mobile_assistant_storage_unavailable' }); }
  });
  router.post('/assistant/sessions/:id/commands', json({ limit: '4kb' }), async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.commandId !== 'string' || !identifier.test(body.commandId) || typeof body.clientMessageId !== 'string' || !identifier.test(body.clientMessageId) || Object.keys(body).some(key => !['commandId', 'clientMessageId'].includes(key))) {
      res.status(400).json({ error: 'mobile_assistant_command_invalid' }); return;
    }
    try {
      const result = await appendMobileAssistantMessage(store, res.locals as AuthLocals, String(req.params.id), { role: 'assistant', text: '操作请求已记录，请查看执行回执确认进展与结果。', clientMessageId: body.clientMessageId, commandId: body.commandId });
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (error) {
      res.status(error instanceof MobileAssistantSessionError ? error.status : 503).json({ error: error instanceof MobileAssistantSessionError ? error.message : 'mobile_assistant_storage_unavailable' });
    }
  });
  router.post('/assistant/sessions/:id/messages', json({ limit: '64kb' }), async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.role !== 'user' || Object.keys(body).some(key => !['role', 'text', 'clientMessageId', 'commandId'].includes(key))) {
      res.status(400).json({ error: 'mobile_assistant_message_invalid' }); return;
    }
    try {
      const result = await appendMobileAssistantMessage(store, res.locals as AuthLocals, String(req.params.id), body);
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (error) {
      res.status(error instanceof MobileAssistantSessionError ? error.status : 503).json({ error: error instanceof MobileAssistantSessionError ? error.message : 'mobile_assistant_storage_unavailable' });
    }
  });
  return router;
}
