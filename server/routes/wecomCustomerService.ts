import { Router, type RequestHandler } from 'express';
import {
  enforceSupportSessionReadOnly,
  requireAuth,
  type AuthLocals,
} from '../middleware/auth.js';
import {
  requestOrganizationRoleStrict,
  type OrganizationRole,
} from '../lib/organizationRole.js';
import {
  createWeComCustomerService,
  WeComCustomerServiceError,
  type WeComCustomerService,
  type WeComKfConversation,
  type WeComKfDraft,
  type WeComKfOutbound,
} from '../wecom/customerService.js';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function integer(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function conversationStatus(item: WeComKfConversation): string {
  const stored = text(item.status);
  if (stored === 'send_failed') return 'send_failed';
  if (item.human_required || ['queued', 'human'].includes(text(item.status))) return 'human_required';
  if (['waiting_first_response', 'draft_pending', 'in_progress', 'waiting_customer', 'human_required'].includes(stored)) return stored;
  if (['closed', 'resolved'].includes(stored)) return 'resolved';
  return 'in_progress';
}

function publicConversation(item: WeComKfConversation) {
  return {
    id: item.id,
    status: conversationStatus(item),
    customerName: text(item.external_userid),
    lastMessagePreview: text(item.last_message_preview),
    lastMessageAt: text(item.last_message_at),
    openKfId: text(item.open_kfid),
    unreadCount: 0,
    riskLevel: item.human_required ? 'high' : 'low',
  };
}

function publicMessage(item: Record<string, unknown>, outboundStatus?: string) {
  const direction = text(item.direction) === 'inbound' ? 'inbound' : 'outbound';
  return {
    id: text(item.id),
    direction,
    body: text(item.content),
    sentAt: text(item.sent_at),
    status: direction === 'outbound' ? (text(outboundStatus) || 'unconfirmed') : 'received',
    senderName: direction === 'outbound' ? '客服' : '',
  };
}

function publicDraft(item: WeComKfDraft) {
  return {
    id: item.id,
    body: text(item.content),
    riskLevel: item.risk_level === 'high' ? 'high' : 'low',
    requiresHumanReview: Boolean(item.requires_human_review),
    riskReasons: Array.isArray(item.risk_reasons)
      ? item.risk_reasons.filter(value => typeof value === 'string')
      : [],
    knowledgeCitations: [],
    status: text(item.status) === 'draft' ? 'pending' : text(item.status),
  };
}

function publicOutbound(item: WeComKfOutbound) {
  return {
    id: item.id,
    status: item.status,
    error: text(item.failure_reason),
  };
}

function sendError(res: Parameters<RequestHandler>[1], error: unknown): void {
  if (error instanceof WeComCustomerServiceError) {
    res.status(error.status).json({ error: error.code, message: error.message });
    return;
  }
  console.error('[wecom-customer-service]', error);
  res.status(503).json({ error: 'wecom_customer_service_unavailable', message: '企业微信客服服务暂不可用。' });
}

export function createWeComCustomerServiceRouter(input: {
  service?: WeComCustomerService;
  authenticate?: RequestHandler;
  resolveRole?: (
    authorization: string | undefined,
    userId: string,
  ) => Promise<OrganizationRole | null>;
} = {}) {
  const router = Router();
  const service = input.service ?? createWeComCustomerService();
  const authenticate = input.authenticate ?? requireAuth;
  const resolveRole = input.resolveRole ?? requestOrganizationRoleStrict;

  router.use(authenticate);
  router.use(enforceSupportSessionReadOnly);
  router.use(async (req, res, next) => {
    const locals = res.locals as AuthLocals;
    try {
      const role = locals.browserReadRole ?? await resolveRole(req.headers.authorization, locals.userId);
      if (!role || !['super_admin', 'admin', 'customer_service'].includes(role)) {
        res.status(403).json({ error: 'wecom_customer_service_forbidden' });
        return;
      }
      next();
    } catch (error) {
      console.error('[wecom-customer-service-role]', error);
      res.status(503).json({ error: 'organization_role_unavailable' });
    }
  });

  router.get('/connection/status', async (_req, res) => {
    try {
      const { tenantId } = res.locals as AuthLocals;
      const connection = await service.connectionStatus(tenantId);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ connection });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/callbacks/recover', async (req, res) => {
    try {
      const { tenantId } = res.locals as AuthLocals;
      const recovery = await service.recoverCallbacks({
        tenantId,
        limit: integer(req.body?.limit, 25),
      });
      res.json({ recovery });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/conversations', async (req, res) => {
    try {
      const { tenantId } = res.locals as AuthLocals;
      const result = await service.listConversations({
        tenantId,
        status: text(req.query.status),
        openKfId: text(req.query.openKfId),
        page: integer(req.query.page, 1),
        perPage: integer(req.query.perPage, 30),
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ...result, items: result.items.map(publicConversation) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/conversations/:id/messages', async (req, res) => {
    try {
      const { tenantId } = res.locals as AuthLocals;
      const detail = await service.getConversationDetail({
        tenantId,
        conversationId: text(req.params.id),
      });
      const outboundStatuses = new Map(detail.outbound.map(item => [item.provider_msg_id, item.status]));
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        conversation: publicConversation(detail.conversation),
        messages: detail.messages.map(item => publicMessage(item, outboundStatuses.get(text(item.provider_msg_id)))),
        drafts: detail.drafts.map(publicDraft),
        outbound: detail.outbound.map(publicOutbound),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/conversations/:id/draft', async (req, res) => {
    try {
      const { tenantId, userId } = res.locals as AuthLocals;
      const draft = await service.createDraft({
        tenantId,
        userId,
        conversationId: text(req.params.id),
        instruction: text(req.body?.instruction),
      });
      res.status(201).json({ draft: publicDraft(draft) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/conversations/:id/send', async (req, res) => {
    try {
      const { tenantId, userId } = res.locals as AuthLocals;
      const headerKey = Array.isArray(req.headers['idempotency-key'])
        ? req.headers['idempotency-key'][0]
        : req.headers['idempotency-key'];
      const outbound = await service.sendDraft({
        tenantId,
        userId,
        conversationId: text(req.params.id),
        draftId: text(req.body?.draftId),
        humanApproved: req.body?.humanApproved === true,
        idempotencyKey: text(headerKey) || text(req.body?.idempotencyKey),
      });
      res.status(outbound.status === 'accepted_unconfirmed' ? 202 : 200).json({
        ...publicOutbound(outbound),
        message: outbound.status === 'accepted_unconfirmed'
          ? '企业微信 API 已受理，尚未确认送达。'
          : '已返回同一幂等请求的现有状态。',
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/conversations/:id/handoff', async (req, res) => {
    try {
      const { tenantId, userId } = res.locals as AuthLocals;
      const result = await service.handoff({
        tenantId,
        userId,
        conversationId: text(req.params.id),
        reason: text(req.body?.reason),
        servicerUserId: text(req.body?.servicerUserId),
      });
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/outbound/:id', async (req, res) => {
    try {
      const { tenantId } = res.locals as AuthLocals;
      const outbound = await service.getOutbound(tenantId, text(req.params.id));
      res.setHeader('Cache-Control', 'no-store');
      res.json(publicOutbound(outbound));
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}

export const wecomCustomerServiceRouter = createWeComCustomerServiceRouter();
