import crypto from 'node:crypto';
import type { DataStore, ListResult, Record_ } from '../storage/datastore.js';
import { store as defaultStore } from '../storage/index.js';
import {
  decryptSecret,
  getTenantPlatformApp,
} from '../lib/tenantPlatformApps.js';
import {
  createWeComKfProvider,
  type WeComKfProvider,
  type WeComKfSyncMessage,
} from '../integrations/wecom.js';
import { createWeComOutboundActions } from './customerServiceOutbound.js';
import { createWeComCallbackActions, type WeComCallbackInput } from './customerServiceCallbacks.js';

export const WECOM_KF_COLLECTIONS = {
  callbacks: 'wecom_kf_callbacks',
  syncStates: 'wecom_kf_sync_states',
  conversations: 'wecom_kf_conversations',
  messages: 'wecom_kf_messages',
  drafts: 'wecom_kf_drafts',
  outbounds: 'wecom_kf_outbounds',
} as const;

const MAX_SYNC_PAGES = 100;
const MAX_TEXT_BYTES = 2048;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function digest(...parts: unknown[]): string {
  return crypto.createHash('sha256').update(parts.map(value => String(value ?? '')).join('\0')).digest('hex');
}

function isoFromProviderTime(value: unknown, fallback: number): string {
  const raw = number(value);
  const millis = raw > 10_000_000_000 ? raw : raw > 0 ? raw * 1000 : fallback;
  return new Date(millis).toISOString();
}

function asRecord<T extends Record_ = Record_>(value: T | null, error: string): T {
  if (!value) throw new WeComCustomerServiceError(error, 503);
  return value;
}

async function first<T extends Record_>(
  dataStore: DataStore,
  collection: string,
  where: Record<string, string | number | boolean>,
): Promise<T | null> {
  const result = await dataStore.list<T>(collection, { where, perPage: 1 });
  return result.items[0] ?? null;
}

export interface WeComKfConnection {
  corpId: string;
  corpSecret: string;
  callbackToken: string;
  encodingAesKey: string;
  credentialMode: 'tenant_secret';
}

export interface WeComKfConversation extends Record_ {
  tenant_id: string;
  conversation_key: string;
  open_kfid: string;
  external_userid: string;
  status?: string;
  service_state?: number;
  servicer_userid?: string;
  last_inbound_at?: string;
  last_message_at?: string;
  last_message_preview?: string;
  human_required?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface WeComKfDraft extends Record_ {
  tenant_id: string;
  conversation_id: string;
  content: string;
  risk_level: 'normal' | 'high';
  requires_human_review: boolean;
  risk_reasons?: unknown;
  status: string;
  created_by: string;
  created_at: string;
}

export interface WeComKfOutbound extends Record_ {
  tenant_id: string;
  conversation_id: string;
  draft_id: string;
  caller_key: string;
  client_idempotency_key: string;
  provider_msg_id: string;
  window_key?: string;
  send_slot?: number;
  status: 'submitting' | 'accepted_unconfirmed' | 'failed' | 'unknown';
  failure_code?: string;
  failure_reason?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type WeComDraftGenerator = (input: {
  tenantId: string;
  conversation: WeComKfConversation;
  recentMessages: Record_[];
  instruction: string;
}) => Promise<string>;

export class WeComCustomerServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, status = 400, message = code) {
    super(message);
    this.name = 'WeComCustomerServiceError';
    this.status = status;
    this.code = code;
  }
}

const HIGH_RISK_PATTERNS: Array<[RegExp, string]> = [
  [/(价格|报价|折扣|优惠|最低价|price|quote|discount)/i, 'commercial_terms'],
  [/(付款|支付|收款|账户|银行卡|payment|bank|invoice)/i, 'payment'],
  [/(退款|退货|赔偿|refund|return|compensation)/i, 'refund_or_compensation'],
  [/(合同|条款|法律|诉讼|contract|legal|lawsuit)/i, 'legal_commitment'],
  [/(认证|证书|合规|海关|certif|compliance|customs)/i, 'compliance_claim'],
  [/(保证|承诺|一定|绝对|guarantee|promise|100%)/i, 'guarantee'],
  [/(密码|验证码|身份证|护照|credential|password|passport)/i, 'sensitive_data'],
];

export function classifyWeComDraftRisk(content: string): {
  level: 'normal' | 'high';
  reasons: string[];
  requiresHumanReview: boolean;
} {
  const reasons = HIGH_RISK_PATTERNS
    .filter(([pattern]) => pattern.test(content))
    .map(([, reason]) => reason);
  return { level: reasons.length ? 'high' : 'normal', reasons, requiresHumanReview: reasons.length > 0 };
}

function defaultDraftGenerator(input: Parameters<WeComDraftGenerator>[0]): Promise<string> {
  const latestInbound = [...input.recentMessages]
    .reverse()
    .find(item => text(item.direction) === 'inbound');
  const topic = text(latestInbound?.content);
  return Promise.resolve(topic
    ? `您好，已收到您关于“${topic.slice(0, 80)}”的消息。我们正在核实信息，会尽快由客服回复您。`
    : '您好，已收到您的消息。我们正在核实信息，会尽快由客服回复您。');
}

async function defaultConnectionLoader(tenantId: string): Promise<WeComKfConnection | null> {
  const app = await getTenantPlatformApp(tenantId, 'wecom');
  if (!app) return null;
  const connection: WeComKfConnection = {
    corpId: text(app.app_id),
    corpSecret: decryptSecret(app.app_secret),
    callbackToken: text(app.webhook_verify_token),
    encodingAesKey: decryptSecret(app.wecom_encoding_aes_key),
    credentialMode: 'tenant_secret',
  };
  return connection.corpId && connection.corpSecret && connection.callbackToken && connection.encodingAesKey
    ? connection
    : null;
}

export function createWeComCustomerService(input: {
  dataStore?: DataStore;
  provider?: WeComKfProvider;
  loadConnection?: (tenantId: string) => Promise<WeComKfConnection | null>;
  generateDraft?: WeComDraftGenerator;
  now?: () => number;
} = {}) {
  const dataStore = input.dataStore ?? defaultStore;
  const provider = input.provider ?? createWeComKfProvider();
  const loadConnection = input.loadConnection ?? defaultConnectionLoader;
  const generateDraftContent = input.generateDraft ?? defaultDraftGenerator;
  const now = input.now ?? Date.now;

  async function requireConnection(tenantId: string): Promise<WeComKfConnection> {
    const connection = await loadConnection(text(tenantId));
    if (!connection
      || !text(connection.corpId)
      || !text(connection.corpSecret)
      || !text(connection.callbackToken)
      || !text(connection.encodingAesKey)) {
      throw new WeComCustomerServiceError('wecom_customer_service_not_configured', 503);
    }
    return connection;
  }

  async function getConversation(tenantId: string, conversationId: string): Promise<WeComKfConversation> {
    const conversation = await dataStore.getById<WeComKfConversation>(
      WECOM_KF_COLLECTIONS.conversations,
      text(conversationId),
    );
    if (!conversation || conversation.tenant_id !== tenantId) {
      throw new WeComCustomerServiceError('wecom_conversation_not_found', 404);
    }
    return conversation;
  }

  async function findOrCreateConversation(args: {
    tenantId: string;
    openKfId: string;
    externalUserId: string;
    at: string;
  }): Promise<WeComKfConversation> {
    const conversationKey = digest(args.openKfId, args.externalUserId);
    const existing = await first<WeComKfConversation>(dataStore, WECOM_KF_COLLECTIONS.conversations, {
      tenant_id: args.tenantId,
      conversation_key: conversationKey,
    });
    if (existing) return existing;
    try {
      return asRecord(await dataStore.create<WeComKfConversation>(WECOM_KF_COLLECTIONS.conversations, {
        tenant_id: args.tenantId,
        conversation_key: conversationKey,
        open_kfid: args.openKfId,
        external_userid: args.externalUserId,
        status: 'active',
        service_state: -1,
        servicer_userid: '',
        last_inbound_at: '',
        last_message_at: args.at,
        last_message_preview: '',
        human_required: false,
        created_at: args.at,
        updated_at: args.at,
      }), 'wecom_conversation_persistence_failed');
    } catch (error) {
      const raced = await first<WeComKfConversation>(dataStore, WECOM_KF_COLLECTIONS.conversations, {
        tenant_id: args.tenantId,
        conversation_key: conversationKey,
      });
      if (raced) return raced;
      throw error;
    }
  }

  async function markOutboundFailed(tenantId: string, providerMsgId: string, failType: unknown): Promise<void> {
    if (!providerMsgId) return;
    const outbound = await first<WeComKfOutbound>(dataStore, WECOM_KF_COLLECTIONS.outbounds, {
      tenant_id: tenantId,
      provider_msg_id: providerMsgId,
    });
    if (!outbound) return;
    await dataStore.update(WECOM_KF_COLLECTIONS.outbounds, outbound.id, {
      status: 'failed',
      failure_code: String(failType ?? ''),
      failure_reason: 'wecom_msg_send_fail_event',
      updated_at: new Date(now()).toISOString(),
    });
    await dataStore.update(WECOM_KF_COLLECTIONS.conversations, outbound.conversation_id, {
      status: 'send_failed',
      human_required: true,
      updated_at: new Date(now()).toISOString(),
    });
  }

  async function persistSyncedMessage(tenantId: string, message: WeComKfSyncMessage): Promise<boolean> {
    const event = object(message.event);
    const eventType = text(event.event_type || event.event || message.event_type);
    const providerMsgId = text(message.msgid)
      || `event_${digest(tenantId, JSON.stringify(message)).slice(0, 40)}`;
    const duplicate = await first(dataStore, WECOM_KF_COLLECTIONS.messages, {
      tenant_id: tenantId,
      provider_msg_id: providerMsgId,
    });
    if (duplicate) return false;

    if (eventType === 'msg_send_fail') {
      await markOutboundFailed(tenantId, text(event.fail_msgid), event.fail_type);
    }

    const openKfId = text(message.open_kfid || event.open_kfid);
    const externalUserId = text(message.external_userid || event.external_userid);
    if (!openKfId || !externalUserId) {
      await dataStore.create(WECOM_KF_COLLECTIONS.messages, {
        tenant_id: tenantId,
        conversation_id: '',
        provider_msg_id: providerMsgId,
        open_kfid: openKfId,
        external_userid: externalUserId,
        direction: 'system',
        origin: number(message.origin),
        msg_type: text(message.msgtype) || (eventType ? 'event' : 'unknown'),
        event_type: eventType,
        content: '',
        sent_at: isoFromProviderTime(message.send_time, now()),
        raw_payload: message,
        created_at: new Date(now()).toISOString(),
      });
      return true;
    }

    const sentAt = isoFromProviderTime(message.send_time, now());
    const conversation = await findOrCreateConversation({ tenantId, openKfId, externalUserId, at: sentAt });
    const origin = number(message.origin);
    const direction = origin === 3 ? 'inbound' : origin === 5 ? 'human_outbound' : 'system';
    const content = text(object(message.text).content);
    try {
      asRecord(await dataStore.create(WECOM_KF_COLLECTIONS.messages, {
        tenant_id: tenantId,
        conversation_id: conversation.id,
        provider_msg_id: providerMsgId,
        open_kfid: openKfId,
        external_userid: externalUserId,
        direction,
        origin,
        msg_type: text(message.msgtype) || (eventType ? 'event' : 'unknown'),
        event_type: eventType,
        content,
        sent_at: sentAt,
        raw_payload: message,
        created_at: new Date(now()).toISOString(),
      }), 'wecom_message_persistence_failed');
    } catch (error) {
      const raced = await first(dataStore, WECOM_KF_COLLECTIONS.messages, {
        tenant_id: tenantId,
        provider_msg_id: providerMsgId,
      });
      if (raced) return false;
      throw error;
    }

    const patch: Record<string, unknown> = {
      last_message_at: sentAt,
      last_message_preview: content.slice(0, 160),
      updated_at: new Date(now()).toISOString(),
    };
    if (origin === 3) {
      patch.last_inbound_at = sentAt;
      if (!conversation.human_required && !['queued', 'human'].includes(text(conversation.status))) {
        patch.status = 'waiting_first_response';
      }
    }
    if (eventType === 'session_status_change') {
      const state = number(event.service_state, -1);
      patch.service_state = state;
      patch.servicer_userid = text(event.servicer_userid);
      patch.status = state === 4 ? 'closed' : state === 2 ? 'queued' : state === 3 ? 'human' : 'active';
    }
    await dataStore.update(WECOM_KF_COLLECTIONS.conversations, conversation.id, patch);
    return true;
  }

  async function syncFromCallback(args: {
    tenantId: string;
    connection: WeComKfConnection;
    token: string;
    openKfId: string;
    tokenExpiresAt: number;
    heartbeat: () => Promise<void>;
  }): Promise<{ pages: number; messages: number }> {
    const stateKey = text(args.openKfId) || '_all';
    let state = await first(dataStore, WECOM_KF_COLLECTIONS.syncStates, {
      tenant_id: args.tenantId,
      open_kfid: stateKey,
    });
    let cursor = text(state?.cursor);
    let pages = 0;
    let savedMessages = 0;
    let hasMore = true;
    while (hasMore) {
      await args.heartbeat();
      if (now() > args.tokenExpiresAt) throw new WeComCustomerServiceError('wecom_callback_token_expired', 409);
      if (pages >= MAX_SYNC_PAGES) throw new WeComCustomerServiceError('wecom_sync_page_limit_reached', 503);
      const page = await provider.syncMessages({
        corpId: args.connection.corpId,
        corpSecret: args.connection.corpSecret,
        cursor,
        token: args.token,
        openKfId: args.openKfId || undefined,
        limit: 1000,
      });
      pages += 1;
      for (let messageIndex = 0; messageIndex < page.messages.length; messageIndex += 1) {
        if (messageIndex > 0 && messageIndex % 25 === 0) await args.heartbeat();
        const message = page.messages[messageIndex];
        if (await persistSyncedMessage(args.tenantId, message)) savedMessages += 1;
      }
      await args.heartbeat();
      const nextCursor = text(page.nextCursor);
      if (page.hasMore && (!nextCursor || nextCursor === cursor)) {
        throw new WeComCustomerServiceError('wecom_sync_cursor_stalled', 503);
      }
      const statePatch = {
        tenant_id: args.tenantId,
        open_kfid: stateKey,
        cursor: nextCursor || cursor,
        last_synced_at: new Date(now()).toISOString(),
        updated_at: new Date(now()).toISOString(),
      };
      if (state) {
        await dataStore.update(WECOM_KF_COLLECTIONS.syncStates, state.id, statePatch);
        state = { ...state, ...statePatch };
      } else {
        state = asRecord(await dataStore.create(WECOM_KF_COLLECTIONS.syncStates, statePatch), 'wecom_sync_state_persistence_failed');
      }
      cursor = nextCursor || cursor;
      hasMore = page.hasMore;
    }
    return { pages, messages: savedMessages };
  }

  const callbackActions = createWeComCallbackActions({
    dataStore,
    callbacksCollection: WECOM_KF_COLLECTIONS.callbacks,
    now,
    requireConnection,
    syncFromCallback,
    createError: (code, status) => new WeComCustomerServiceError(code, status),
  });

  /** Compatibility helper for callers that explicitly want synchronous processing. */
  async function receiveCallback(args: WeComCallbackInput): Promise<{
    duplicate: boolean;
    pages: number;
    messages: number;
  }> {
    const ingestion = await callbackActions.ingestCallback(args);
    if (!ingestion.shouldProcess) return { duplicate: true, pages: 0, messages: 0 };
    const result = await callbackActions.processCallback({
      tenantId: args.tenantId,
      callbackId: ingestion.callbackId,
    });
    return {
      duplicate: ingestion.duplicate || result.status !== 'processed',
      pages: result.pages,
      messages: result.messages,
    };
  }

  async function connectionStatus(tenantId: string) {
    const connection = await loadConnection(text(tenantId));
    const configured = Boolean(connection
      && text(connection.corpId)
      && text(connection.corpSecret)
      && text(connection.callbackToken)
      && text(connection.encodingAesKey));
    const protocolLimits = {
      credentialMode: 'tenant_secret' as const,
      thirdPartyAuthorizationSupported: false,
      deliveryConfirmationAvailable: false,
      callbackTokenTtlSeconds: 600,
      syncHistoryWindowDays: 3,
      outboundWindowHours: 48,
      outboundLimitPerCustomerMessage: 5,
    };
    if (!configured) {
      return {
        status: 'unconfigured' as const,
        connected: false,
        label: '微信客服尚未配置',
        lastSyncAt: '',
        pendingCount: 0,
        humanRequiredCount: 0,
        reason: '请完整配置 CorpID、微信客服 Secret、回调 Token 与 EncodingAESKey。',
        configured: false,
        ...protocolLimits,
        nativeReceptionRulesEffective: null,
        lastSyncedAt: '',
        warning: '企业微信微信客服凭证、回调 Token 或 EncodingAESKey 未完整配置，读写均关闭。',
      };
    }
    const [lastSync, conversations] = await Promise.all([
      dataStore.list(WECOM_KF_COLLECTIONS.syncStates, {
        where: { tenant_id: tenantId },
        sort: '-last_synced_at',
        perPage: 1,
      }),
      dataStore.list<WeComKfConversation>(WECOM_KF_COLLECTIONS.conversations, {
        where: { tenant_id: tenantId },
        perPage: 200,
      }),
    ]);
    const lastSyncedAt = text(lastSync.items[0]?.last_synced_at);
    const connected = configured && Boolean(lastSyncedAt);
    const humanRequiredCount = conversations.items.filter(item => item.human_required || ['queued', 'human'].includes(text(item.status))).length;
    const pendingCount = conversations.items.filter(item => !['closed', 'resolved'].includes(text(item.status))).length;
    return {
      status: connected ? 'connected' : 'configuring',
      connected,
      label: connected ? '微信客服已连接并完成消息同步' : '等待首条真实消息完成链路验收',
      lastSyncAt: lastSyncedAt,
      pendingCount,
      humanRequiredCount,
      reason: '发送成功仅表示企业微信 API 已受理，最终失败会由同步事件更新。',
      configured: true,
      ...protocolLimits,
      nativeReceptionRulesEffective: configured ? false : null,
      lastSyncedAt,
      warning: 'API 接管后企业微信原生接待规则不再生效；发送成功仅表示受理，失败以同步事件为准。',
    };
  }

  async function listConversations(args: {
    tenantId: string;
    status?: string;
    openKfId?: string;
    page?: number;
    perPage?: number;
  }): Promise<ListResult<WeComKfConversation>> {
    await requireConnection(args.tenantId);
    const requestedStatus = text(args.status);
    const storedStatus = requestedStatus === 'resolved' ? 'closed' : requestedStatus;
    return dataStore.list<WeComKfConversation>(WECOM_KF_COLLECTIONS.conversations, {
      where: {
        tenant_id: args.tenantId,
        ...(requestedStatus === 'human_required'
          ? { human_required: true }
          : storedStatus && storedStatus !== 'all' ? { status: storedStatus } : {}),
        ...(text(args.openKfId) ? { open_kfid: text(args.openKfId) } : {}),
      },
      sort: '-last_message_at',
      page: Math.max(1, number(args.page, 1)),
      perPage: Math.min(100, Math.max(1, number(args.perPage, 30))),
    });
  }

  async function listMessages(args: {
    tenantId: string;
    conversationId: string;
    page?: number;
    perPage?: number;
  }): Promise<ListResult> {
    await requireConnection(args.tenantId);
    await getConversation(args.tenantId, args.conversationId);
    return dataStore.list(WECOM_KF_COLLECTIONS.messages, {
      where: { tenant_id: args.tenantId, conversation_id: args.conversationId },
      sort: 'sent_at',
      page: Math.max(1, number(args.page, 1)),
      perPage: Math.min(200, Math.max(1, number(args.perPage, 100))),
    });
  }

  async function getConversationDetail(args: {
    tenantId: string;
    conversationId: string;
  }): Promise<{
    conversation: WeComKfConversation;
    messages: Record_[];
    drafts: WeComKfDraft[];
    outbound: WeComKfOutbound[];
  }> {
    await requireConnection(args.tenantId);
    const conversation = await getConversation(args.tenantId, args.conversationId);
    const [messages, drafts, outbound] = await Promise.all([
      dataStore.list(WECOM_KF_COLLECTIONS.messages, {
        where: { tenant_id: args.tenantId, conversation_id: conversation.id },
        sort: 'sent_at',
        perPage: 200,
      }),
      dataStore.list<WeComKfDraft>(WECOM_KF_COLLECTIONS.drafts, {
        where: { tenant_id: args.tenantId, conversation_id: conversation.id },
        sort: '-created_at',
        perPage: 30,
      }),
      dataStore.list<WeComKfOutbound>(WECOM_KF_COLLECTIONS.outbounds, {
        where: { tenant_id: args.tenantId, conversation_id: conversation.id },
        sort: '-created_at',
        perPage: 30,
      }),
    ]);
    return { conversation, messages: messages.items, drafts: drafts.items, outbound: outbound.items };
  }

  async function createDraft(args: {
    tenantId: string;
    conversationId: string;
    userId: string;
    instruction?: string;
  }): Promise<WeComKfDraft> {
    await requireConnection(args.tenantId);
    const conversation = await getConversation(args.tenantId, args.conversationId);
    const recent = await dataStore.list(WECOM_KF_COLLECTIONS.messages, {
      where: { tenant_id: args.tenantId, conversation_id: conversation.id },
      sort: '-sent_at',
      perPage: 20,
    });
    const content = text(await generateDraftContent({
      tenantId: args.tenantId,
      conversation,
      recentMessages: recent.items,
      instruction: text(args.instruction),
    }));
    if (!content) throw new WeComCustomerServiceError('wecom_draft_empty', 503);
    if (Buffer.byteLength(content, 'utf8') > MAX_TEXT_BYTES) {
      throw new WeComCustomerServiceError('wecom_draft_too_long', 422);
    }
    const riskContext = [
      content,
      text(args.instruction),
      ...recent.items.filter(item => text(item.direction) === 'inbound').map(item => text(item.content)),
    ].join('\n');
    const risk = classifyWeComDraftRisk(riskContext);
    const createdAt = new Date(now()).toISOString();
    const draft = asRecord(await dataStore.create<WeComKfDraft>(WECOM_KF_COLLECTIONS.drafts, {
      tenant_id: args.tenantId,
      conversation_id: conversation.id,
      content,
      risk_level: risk.level,
      requires_human_review: risk.requiresHumanReview,
      risk_reasons: risk.reasons,
      status: 'draft',
      created_by: args.userId,
      created_at: createdAt,
      updated_at: createdAt,
    }), 'wecom_draft_persistence_failed');
    if (risk.requiresHumanReview) {
      await dataStore.update(WECOM_KF_COLLECTIONS.conversations, conversation.id, {
        human_required: true,
        status: 'human_required',
        updated_at: createdAt,
      });
    } else {
      await dataStore.update(WECOM_KF_COLLECTIONS.conversations, conversation.id, {
        status: conversation.human_required ? 'human_required' : 'draft_pending',
        updated_at: createdAt,
      });
    }
    return draft;
  }

  const { sendDraft, handoff, getOutbound } = createWeComOutboundActions({
    dataStore,
    provider,
    now,
    collections: WECOM_KF_COLLECTIONS,
    requireConnection,
    getConversation,
    classifyDraftRisk: classifyWeComDraftRisk,
    createError: (code, status) => new WeComCustomerServiceError(code, status),
  });
  return {
    connectionStatus,
    receiveCallback,
    ingestCallback: callbackActions.ingestCallback,
    processCallback: callbackActions.processCallback,
    recoverCallbacks: callbackActions.recoverCallbacks,
    listConversations,
    listMessages,
    getConversationDetail,
    createDraft,
    sendDraft,
    handoff,
    getOutbound,
  };
}

export type WeComCustomerService = ReturnType<typeof createWeComCustomerService>;
export const weComCustomerService = createWeComCustomerService();
