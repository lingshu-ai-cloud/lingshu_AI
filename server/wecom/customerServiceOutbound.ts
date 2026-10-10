import crypto from 'node:crypto';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { WeComApiError, type WeComKfProvider } from '../integrations/wecom.js';
import type {
  WeComKfConnection,
  WeComKfConversation,
  WeComKfDraft,
  WeComKfOutbound,
} from './customerService.js';

const SEND_WINDOW_MS = 48 * 60 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 5;
const MAX_TEXT_BYTES = 2048;
const sendQueues = new Map<string, Promise<void>>();

type ServiceError = Error & { status: number; code: string };
type Collections = {
  conversations: string;
  messages: string;
  drafts: string;
  outbounds: string;
};

type OutboundDependencies = {
  dataStore: DataStore;
  provider: WeComKfProvider;
  now: () => number;
  collections: Collections;
  requireConnection: (tenantId: string) => Promise<WeComKfConnection>;
  getConversation: (tenantId: string, conversationId: string) => Promise<WeComKfConversation>;
  classifyDraftRisk: (content: string) => { requiresHumanReview: boolean };
  createError: (code: string, status?: number) => ServiceError;
};

export type SendWeComDraftInput = {
  tenantId: string;
  conversationId: string;
  draftId: string;
  userId: string;
  idempotencyKey: string;
  humanApproved?: boolean;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function digest(...parts: unknown[]): string {
  return crypto.createHash('sha256').update(parts.map(value => String(value ?? '')).join('\0')).digest('hex');
}

async function first<T extends Record_>(
  dataStore: DataStore,
  collection: string,
  where: Record<string, string | number | boolean>,
): Promise<T | null> {
  const result = await dataStore.list<T>(collection, { where, perPage: 1 });
  return result.items[0] ?? null;
}

async function serialized<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = sendQueues.get(key) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>(resolve => { release = resolve; });
  const queued = previous.catch(() => undefined).then(() => current);
  sendQueues.set(key, queued);
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
    if (sendQueues.get(key) === queued) sendQueues.delete(key);
  }
}

export function createWeComOutboundActions(deps: OutboundDependencies) {
  const { dataStore, provider, now, collections } = deps;

  async function sendDraftUnlocked(args: SendWeComDraftInput): Promise<WeComKfOutbound> {
    const connection = await deps.requireConnection(args.tenantId);
    const conversation = await deps.getConversation(args.tenantId, args.conversationId);
    const idempotencyKey = text(args.idempotencyKey);
    if (!idempotencyKey || idempotencyKey.length > 200) throw deps.createError('idempotency_key_required', 400);
    const callerKey = digest(args.tenantId, args.userId, idempotencyKey);
    const existing = await first<WeComKfOutbound>(dataStore, collections.outbounds, {
      tenant_id: args.tenantId,
      caller_key: callerKey,
    });
    if (existing) return existing;
    const draft = await dataStore.getById<WeComKfDraft>(collections.drafts, text(args.draftId));
    if (!draft || draft.tenant_id !== args.tenantId || draft.conversation_id !== conversation.id) {
      throw deps.createError('wecom_draft_not_found', 404);
    }
    const content = text(draft.content);
    const risk = deps.classifyDraftRisk(content);
    if ((draft.requires_human_review || risk.requiresHumanReview) && !args.humanApproved) {
      throw deps.createError('wecom_human_approval_required', 409);
    }
    if (!content || Buffer.byteLength(content, 'utf8') > MAX_TEXT_BYTES) {
      throw deps.createError('wecom_message_invalid', 422);
    }
    const lastInboundAt = Date.parse(text(conversation.last_inbound_at));
    if (!Number.isFinite(lastInboundAt) || now() - lastInboundAt > SEND_WINDOW_MS || now() < lastInboundAt) {
      throw deps.createError('wecom_48h_send_window_closed', 409);
    }
    const recentOutbounds = await dataStore.list<WeComKfOutbound>(collections.outbounds, {
      where: { tenant_id: args.tenantId, conversation_id: conversation.id },
      perPage: 200,
      sort: '-created_at',
    });
    const charged = recentOutbounds.items.filter(item => {
      const createdAt = Date.parse(text(item.created_at));
      return createdAt >= lastInboundAt && ['submitting', 'accepted_unconfirmed', 'unknown', 'failed'].includes(text(item.status));
    });
    if (charged.some(item => ['submitting', 'unknown'].includes(text(item.status)))) {
      throw deps.createError('wecom_send_reconciliation_required', 409);
    }
    if (charged.length >= MAX_SENDS_PER_WINDOW) throw deps.createError('wecom_5_message_limit_reached', 409);
    const remoteState = await provider.getServiceState({
      corpId: connection.corpId,
      corpSecret: connection.corpSecret,
      openKfId: conversation.open_kfid,
      externalUserId: conversation.external_userid,
    });
    if (![0, 1].includes(remoteState.serviceState)) {
      await dataStore.update(collections.conversations, conversation.id, {
        service_state: remoteState.serviceState,
        servicer_userid: remoteState.servicerUserId,
        status: 'human_required',
        human_required: true,
        updated_at: new Date(now()).toISOString(),
      });
      throw deps.createError('wecom_service_state_disallows_api_send', 409);
    }

    const createdAt = new Date(now()).toISOString();
    const localMsgId = digest(args.tenantId, args.userId, idempotencyKey).slice(0, 32);
    const windowKey = digest(conversation.id, conversation.last_inbound_at);
    const sendSlot = charged.length + 1;
    let outbound: WeComKfOutbound;
    try {
      const created = await dataStore.create<WeComKfOutbound>(collections.outbounds, {
        tenant_id: args.tenantId,
        conversation_id: conversation.id,
        draft_id: draft.id,
        caller_key: callerKey,
        client_idempotency_key: idempotencyKey,
        provider_msg_id: localMsgId,
        window_key: windowKey,
        send_slot: sendSlot,
        status: 'submitting',
        human_approved: Boolean(args.humanApproved),
        reviewed_by: args.humanApproved ? args.userId : '',
        failure_code: '',
        failure_reason: '',
        created_by: args.userId,
        created_at: createdAt,
        updated_at: createdAt,
      });
      if (!created) throw deps.createError('wecom_outbound_persistence_failed', 503);
      outbound = created;
    } catch (error) {
      const raced = await first<WeComKfOutbound>(dataStore, collections.outbounds, {
        tenant_id: args.tenantId,
        caller_key: callerKey,
      });
      if (raced) return raced;
      if (error instanceof Error && 'code' in error && error.code === 'wecom_outbound_persistence_failed') throw error;
      throw deps.createError('wecom_send_concurrency_conflict', 409);
    }

    try {
      const accepted = await provider.sendText({
        corpId: connection.corpId,
        corpSecret: connection.corpSecret,
        openKfId: conversation.open_kfid,
        externalUserId: conversation.external_userid,
        content,
        msgId: localMsgId,
      });
      const providerMsgId = text(accepted.msgId) || localMsgId;
      const updatedAt = new Date(now()).toISOString();
      await dataStore.update(collections.outbounds, outbound.id, {
        status: 'accepted_unconfirmed',
        provider_msg_id: providerMsgId,
        updated_at: updatedAt,
      });
      const knownMessage = await first(dataStore, collections.messages, {
        tenant_id: args.tenantId,
        provider_msg_id: providerMsgId,
      });
      if (!knownMessage) {
        await dataStore.create(collections.messages, {
          tenant_id: args.tenantId,
          conversation_id: conversation.id,
          provider_msg_id: providerMsgId,
          open_kfid: conversation.open_kfid,
          external_userid: conversation.external_userid,
          direction: 'api_outbound',
          origin: 4,
          msg_type: 'text',
          event_type: '',
          content,
          sent_at: updatedAt,
          raw_payload: {},
          created_at: updatedAt,
        });
      }
      await dataStore.update(collections.drafts, draft.id, { status: 'sent_unconfirmed', updated_at: updatedAt });
      await dataStore.update(collections.conversations, conversation.id, {
        status: 'waiting_customer',
        service_state: remoteState.serviceState,
        servicer_userid: remoteState.servicerUserId,
        human_required: false,
        updated_at: updatedAt,
      });
      return { ...outbound, status: 'accepted_unconfirmed', provider_msg_id: providerMsgId, updated_at: updatedAt };
    } catch (error) {
      const uncertain = error instanceof WeComApiError && error.uncertain;
      const status = uncertain ? 'unknown' : 'failed';
      const updatedAt = new Date(now()).toISOString();
      await dataStore.update(collections.outbounds, outbound.id, {
        status,
        failure_code: error instanceof WeComApiError ? String(error.code) : 'internal',
        failure_reason: error instanceof Error ? error.message.slice(0, 500) : 'wecom_send_failed',
        updated_at: updatedAt,
      });
      await dataStore.update(collections.conversations, conversation.id, {
        status: 'send_failed',
        human_required: true,
        updated_at: updatedAt,
      });
      throw deps.createError(uncertain ? 'wecom_send_outcome_unknown' : 'wecom_send_rejected', uncertain ? 503 : 502);
    }
  }

  async function sendDraft(args: SendWeComDraftInput): Promise<WeComKfOutbound> {
    return serialized(`send:${text(args.tenantId)}:${text(args.conversationId)}`, () => sendDraftUnlocked(args));
  }

  async function handoff(args: {
    tenantId: string;
    conversationId: string;
    userId: string;
    servicerUserId?: string;
    reason?: string;
  }): Promise<{ status: 'queued' | 'human'; serviceState: 2 | 3 }> {
    const connection = await deps.requireConnection(args.tenantId);
    const conversation = await deps.getConversation(args.tenantId, args.conversationId);
    const current = await provider.getServiceState({
      corpId: connection.corpId,
      corpSecret: connection.corpSecret,
      openKfId: conversation.open_kfid,
      externalUserId: conversation.external_userid,
    });
    if (current.serviceState === 4) throw deps.createError('wecom_conversation_closed', 409);
    const servicerUserId = text(args.servicerUserId);
    const serviceState: 2 | 3 = servicerUserId ? 3 : 2;
    await provider.transferServiceState({
      corpId: connection.corpId,
      corpSecret: connection.corpSecret,
      openKfId: conversation.open_kfid,
      externalUserId: conversation.external_userid,
      serviceState,
      ...(servicerUserId ? { servicerUserId } : {}),
    });
    const status = serviceState === 3 ? 'human' : 'queued';
    await dataStore.update(collections.conversations, conversation.id, {
      status,
      service_state: serviceState,
      servicer_userid: servicerUserId,
      human_required: true,
      handoff_reason: text(args.reason),
      handed_off_by: args.userId,
      updated_at: new Date(now()).toISOString(),
    });
    return { status, serviceState };
  }

  async function getOutbound(tenantId: string, outboundId: string): Promise<WeComKfOutbound> {
    await deps.requireConnection(tenantId);
    const outbound = await dataStore.getById<WeComKfOutbound>(collections.outbounds, outboundId);
    if (!outbound || outbound.tenant_id !== tenantId) throw deps.createError('wecom_outbound_not_found', 404);
    return outbound;
  }

  return { sendDraft, handoff, getOutbound };
}
