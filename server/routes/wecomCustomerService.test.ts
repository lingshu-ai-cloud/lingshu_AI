import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { RequestHandler } from 'express';
import { createWeComCustomerServiceRouter } from './wecomCustomerService.js';
import type { WeComCustomerService } from '../wecom/customerService.js';

test('WeCom customer-service routes require role, keep tenant authority, and expose unconfirmed delivery truthfully', async () => {
  const seen: Array<{ operation: string; tenantId: string; userId?: string }> = [];
  const service = {
    async connectionStatus(tenantId: string) {
      seen.push({ operation: 'status', tenantId });
      return { status: 'connected', connected: true, configured: true, lastSyncAt: '2026-09-19T00:00:00.000Z' };
    },
    async recoverCallbacks(input: { tenantId: string }) {
      seen.push({ operation: 'recover', tenantId: input.tenantId });
      return { attempted: 1, processed: 1, alreadyProcessed: 0, busy: 0, expired: 0, failed: 0 };
    },
    async listConversations(input: { tenantId: string }) {
      seen.push({ operation: 'list', tenantId: input.tenantId });
      return {
        items: [{
          id: 'conversation-a', tenant_id: input.tenantId, conversation_key: 'key', open_kfid: 'wk',
          external_userid: 'customer-external-id', status: 'active', last_message_preview: 'hello',
          last_message_at: '2026-09-19T00:00:00.000Z', human_required: false,
        }],
        totalItems: 1, totalPages: 1, page: 1, perPage: 30,
      };
    },
    async getConversationDetail(input: { tenantId: string }) {
      seen.push({ operation: 'detail', tenantId: input.tenantId });
      return {
        conversation: {
          id: 'conversation-a', tenant_id: input.tenantId, conversation_key: 'key', open_kfid: 'wk',
          external_userid: 'customer-external-id', status: 'active', last_message_preview: 'hello',
        },
        messages: [{ id: 'message-a', direction: 'inbound', content: 'hello', sent_at: '2026-09-19T00:00:00.000Z' }],
        drafts: [],
        outbound: [],
      };
    },
    async createDraft(input: { tenantId: string; userId: string }) {
      seen.push({ operation: 'draft', tenantId: input.tenantId, userId: input.userId });
      return {
        id: 'draft-a', tenant_id: input.tenantId, conversation_id: 'conversation-a',
        content: 'safe', risk_level: 'normal', requires_human_review: false,
        risk_reasons: [], status: 'draft', created_by: input.userId, created_at: '2026-09-19T00:00:00.000Z',
      };
    },
    async sendDraft(input: { tenantId: string; userId: string; idempotencyKey: string }) {
      seen.push({ operation: `send:${input.idempotencyKey}`, tenantId: input.tenantId, userId: input.userId });
      return {
        id: 'outbound-a', tenant_id: input.tenantId, conversation_id: 'conversation-a', draft_id: 'draft-a',
        caller_key: 'caller', client_idempotency_key: input.idempotencyKey, provider_msg_id: 'provider',
        status: 'accepted_unconfirmed' as const, created_by: input.userId,
        created_at: '2026-09-19T00:00:00.000Z', updated_at: '2026-09-19T00:00:00.000Z',
      };
    },
    async handoff(input: { tenantId: string; userId: string }) {
      seen.push({ operation: 'handoff', tenantId: input.tenantId, userId: input.userId });
      return { status: 'queued' as const, serviceState: 2 as const };
    },
    async getOutbound(tenantId: string) {
      seen.push({ operation: 'outbound', tenantId });
      return {
        id: 'outbound-a', tenant_id: tenantId, conversation_id: 'conversation-a', draft_id: 'draft-a',
        caller_key: 'caller', client_idempotency_key: 'idempotency', provider_msg_id: 'provider',
        status: 'accepted_unconfirmed' as const, created_by: 'agent-tenant-a',
        created_at: '2026-09-19T00:00:00.000Z', updated_at: '2026-09-19T00:00:00.000Z',
      };
    },
  } as unknown as WeComCustomerService;

  const authenticate: RequestHandler = (req, res, next) => {
    const tenantId = String(req.headers['x-test-tenant'] ?? '');
    if (!tenantId) { res.sendStatus(401); return; }
    res.locals.tenantId = tenantId;
    res.locals.userId = `agent-${tenantId}`;
    res.locals.browserReadRole = String(req.headers['x-test-role'] ?? 'customer_service');
    if (req.headers['x-test-support']) {
      res.locals.supportAccess = { requestId: 'support-request', adminEmail: 'support@example.com', tenantName: tenantId };
    }
    next();
  };
  const app = express();
  app.use(express.json());
  app.use('/wecom', createWeComCustomerServiceRouter({ service, authenticate }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/wecom`;
  const call = (path: string, init: RequestInit = {}, headers: Record<string, string> = {}) => fetch(`${base}${path}`, {
    ...init,
    headers: { 'x-test-tenant': 'tenant-a', 'x-test-role': 'customer_service', ...headers, ...(init.headers ?? {}) },
  });

  try {
    assert.equal((await fetch(`${base}/connection/status`)).status, 401);
    assert.equal((await call('/connection/status', {}, { 'x-test-role': 'social_operator' })).status, 403);
    const status = await call('/connection/status');
    assert.equal(status.status, 200);
    assert.equal((await status.json()).connection.connected, true);

    const recovery = await call('/callbacks/recover', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 10 }),
    });
    assert.equal(recovery.status, 200);
    assert.equal((await recovery.json()).recovery.processed, 1);
    assert.ok(seen.some(item => item.operation === 'recover' && item.tenantId === 'tenant-a'));

    const list = await call('/conversations');
    const listBody = await list.json();
    assert.equal(listBody.items[0].customerName, 'customer-external-id');
    assert.equal(listBody.items[0].lastMessagePreview, 'hello');

    const detail = await call('/conversations/conversation-a/messages');
    assert.equal((await detail.json()).messages[0].body, 'hello');

    const send = await call('/conversations/conversation-a/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draftId: 'draft-a', humanApproved: true, idempotencyKey: 'client-key' }),
    });
    const sendBody = await send.json();
    assert.equal(send.status, 202);
    assert.equal(sendBody.status, 'accepted_unconfirmed');
    assert.match(sendBody.message, /尚未确认送达/);
    assert.ok(seen.some(item => item.operation === 'send:client-key' && item.tenantId === 'tenant-a' && item.userId === 'agent-tenant-a'));

    const supportMutation = await call('/conversations/conversation-a/handoff', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }, { 'x-test-support': '1' });
    assert.equal(supportMutation.status, 403);
  } finally {
    server.close();
  }
});
