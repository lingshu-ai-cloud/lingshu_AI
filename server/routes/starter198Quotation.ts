import { Router, type Request, type Response } from 'express';
import { browserReadIdentity, isBrowserReadToken } from '../digitalEmployees/browserReadSession.js';
import { requestOrganizationRoleStrict, type OrganizationRole } from '../lib/organizationRole.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import type { Starter198Capability } from '../../shared/contracts/starter198.js';
import { QuotationError } from '../quotation/errors.js';
import { QuotationService, type CreateDraftCommand } from '../quotation/service.js';
import type { ActorContext } from '../quotation/types.js';
import {
  buildStarter198CapabilityManifest,
  starter198CapabilityAllowed,
  type Starter198AccessSnapshot,
} from '../starter198/profile.js';
import {
  Starter198RepositoryError,
  starter198Repository,
  type Starter198Repository,
} from '../starter198/repository.js';
import {
  assertQuoteDraftQuota,
  Starter198QuotaError,
  withStarterQuotaScope,
} from '../starter198/quota.js';

const RULE_MANAGERS = new Set<OrganizationRole>(['super_admin', 'admin']);
const QUOTE_OPERATORS = new Set<OrganizationRole>(['super_admin', 'admin', 'customer_service']);
const QUOTE_APPROVERS = new Set<OrganizationRole>(['super_admin', 'admin']);

function bodyObject(req: Request): Record<string, unknown> {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw new QuotationError('invalid_quote_request', 'JSON request body must be an object', 400);
  }
  const body = req.body as Record<string, unknown>;
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 64 * 1024) {
    throw new QuotationError('quote_request_too_large', 'Quotation request must not exceed 64 KiB', 413);
  }
  if (['tenantId', 'tenant_id', 'userId', 'user_id'].some(key => Object.prototype.hasOwnProperty.call(body, key))) {
    throw new QuotationError('identity_override_forbidden', 'Tenant and actor identity come only from authentication', 400);
  }
  return body;
}

function commandFromBody(body: Record<string, unknown>): CreateDraftCommand {
  return {
    ruleSetKey: typeof body.ruleSetKey === 'string' ? body.ruleSetKey : '',
    ruleSetVersion: typeof body.ruleSetVersion === 'string' ? body.ruleSetVersion : '',
    input: body.input && typeof body.input === 'object' && !Array.isArray(body.input)
      ? body.input
      : {},
  };
}

function noStore(_req: Request, res: Response, next: () => void): void {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Vary', 'Authorization');
  next();
}

async function mutationActor(
  req: Request,
  res: Response,
  allowed: ReadonlySet<OrganizationRole>,
): Promise<ActorContext | null> {
  const identity = res.locals as AuthLocals;
  if (isBrowserReadToken(req.headers.authorization)) {
    res.status(403).json({ error: 'agent_browser_read_only' });
    return null;
  }
  if (identity.supportAccess) {
    res.status(403).json({ error: 'support_access_read_only' });
    return null;
  }
  if (!identity.userId || !identity.tenantId || identity.userId === 'signed-media') {
    res.status(403).json({ error: 'quotation_actor_required' });
    return null;
  }
  const role = await requestOrganizationRoleStrict(req.headers.authorization, identity.userId);
  if (!role || !allowed.has(role)) {
    res.status(403).json({
      error: 'quotation_role_required',
      message: '当前角色无权执行此报价操作。',
    });
    return null;
  }
  return { tenantId: identity.tenantId, userId: identity.userId, role };
}

async function readActor(req: Request, res: Response): Promise<ActorContext | null> {
  const identity = res.locals as AuthLocals;
  if (identity.supportAccess) {
    return { tenantId: identity.tenantId, userId: identity.userId, role: 'customer_service' };
  }
  if (isBrowserReadToken(req.headers.authorization)) {
    const browserIdentity = browserReadIdentity(req);
    if (!browserIdentity || browserIdentity.role === 'social_operator') {
      res.status(403).json({ error: 'quotation_role_required' });
      return null;
    }
    return { tenantId: identity.tenantId, userId: identity.userId, role: browserIdentity.role };
  }
  const role = await requestOrganizationRoleStrict(req.headers.authorization, identity.userId);
  if (!role || !QUOTE_OPERATORS.has(role)) {
    res.status(403).json({ error: 'quotation_role_required' });
    return null;
  }
  return {
    tenantId: identity.tenantId,
    userId: identity.userId,
    role,
  };
}

function idempotencyHeader(req: Request): unknown {
  return req.get('Idempotency-Key');
}

function draftId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(value)) {
    throw new QuotationError('invalid_quote_request', 'Draft id is invalid', 400);
  }
  return value;
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof Starter198QuotaError) {
    res.status(error.status).json({ error: error.code, message: error.code });
    return;
  }
  if (error instanceof QuotationError) {
    res.status(error.status).json({
      error: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    });
    return;
  }
  res.status(500).json({ error: 'quotation_internal_error' });
}

async function requireCapabilities(
  res: Response,
  tenantId: string,
  capabilities: readonly Starter198Capability[],
  accessRepository: Pick<Starter198Repository, 'access'>,
  now: () => Date,
): Promise<Starter198AccessSnapshot | null> {
  try {
    const access = await accessRepository.access(tenantId);
    const manifest = buildStarter198CapabilityManifest(access, now());
    for (const capability of capabilities) {
      if (starter198CapabilityAllowed(manifest, capability)) continue;
      res.status(403).json({
        error: 'starter_198_quotation_capability_denied',
        capability,
        reason: manifest.capabilities[capability].reason,
      });
      return null;
    }
    return access;
  } catch (error) {
    if (error instanceof Starter198RepositoryError && error.code === 'starter_198_not_provisioned') {
      res.status(403).json({ error: 'starter_198_not_provisioned' });
      return null;
    }
    res.status(503).json({ error: 'starter_198_access_unavailable' });
    return null;
  }
}

/**
 * starter_198 commercial boundary: deterministic estimates, internal drafts,
 * immutable human approval, and unverified evidence submitted after a human
 * sends outside the system. No route invokes a provider or sends a quote.
 */
export function createStarter198QuotationRouter(
  quotationService: QuotationService = new QuotationService(store),
  accessRepository: Pick<Starter198Repository, 'access'> = starter198Repository,
  now: () => Date = () => new Date(),
  quotaRepository: Pick<Starter198Repository, 'list'> = starter198Repository,
): Router {
  const router = Router();
  router.use(requireAuth);
  router.use(noStore);

  router.post('/rule-sets', async (req, res) => {
    try {
      const actor = await mutationActor(req, res, RULE_MANAGERS);
      if (!actor) return;
      if (!await requireCapabilities(res, actor.tenantId, ['quotation.calculate'], accessRepository, now)) return;
      const body = bodyObject(req);
      const result = await quotationService.createRuleSet(actor, body.ruleSet ?? body, idempotencyHeader(req));
      res.status(201).json({ ...result, capabilityBoundary: 'deterministic_quote_human_approval_no_provider_send' });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/estimate', async (req, res) => {
    try {
      const actor = await mutationActor(req, res, QUOTE_OPERATORS);
      if (!actor) return;
      if (!await requireCapabilities(res, actor.tenantId, ['quotation.calculate'], accessRepository, now)) return;
      const result = await quotationService.estimate(actor, commandFromBody(bodyObject(req)));
      res.json({ ...result, externalEffect: 'none', approvalAvailable: false });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/drafts', async (req, res) => {
    try {
      const actor = await mutationActor(req, res, QUOTE_OPERATORS);
      if (!actor) return;
      const access = await requireCapabilities(res, actor.tenantId, ['quotation.calculate'], accessRepository, now);
      if (!access) return;
      const body = commandFromBody(bodyObject(req));
      const rawIdempotency = idempotencyHeader(req);
      const idempotencyKey = typeof rawIdempotency === 'string' ? rawIdempotency.trim() : '';
      const result = await withStarterQuotaScope(`quote:${actor.tenantId}:${access.entitlementSnapshotId}`, async () => {
        await assertQuoteDraftQuota({
          repository: quotaRepository,
          tenantId: actor.tenantId,
          cycleStartedAt: access.cycleStartedAt,
          cycleEndsAt: access.cycleEndsAt,
          limits: access.resourceLimits,
          now: now(),
          ...(idempotencyKey ? { idempotencyKey } : {}),
        });
        return quotationService.createDraft(actor, body, rawIdempotency);
      });
      res.status(201).json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/drafts/:id/approve', async (req, res) => {
    try {
      const actor = await mutationActor(req, res, QUOTE_APPROVERS);
      if (!actor) return;
      if (!await requireCapabilities(res, actor.tenantId, ['quotation.calculate', 'orchestrator.decision.resolve'], accessRepository, now)) return;
      const body = bodyObject(req);
      const result = await quotationService.approveDraft(
        actor,
        draftId(req.params.id),
        idempotencyHeader(req),
        body.decisionNote,
      );
      res.status(201).json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/drafts/:id/decision', async (req, res) => {
    try {
      const actor = await mutationActor(req, res, QUOTE_APPROVERS);
      if (!actor) return;
      if (!await requireCapabilities(res, actor.tenantId, ['quotation.calculate', 'orchestrator.decision.resolve'], accessRepository, now)) return;
      const body = bodyObject(req);
      const result = await quotationService.decideDraft(
        actor,
        draftId(req.params.id),
        idempotencyHeader(req),
        body.decision,
        body.decisionNote,
      );
      res.status(201).json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/drafts/:id/external-send-evidence', async (req, res) => {
    try {
      const actor = await mutationActor(req, res, QUOTE_OPERATORS);
      if (!actor) return;
      if (!await requireCapabilities(res, actor.tenantId, ['quotation.calculate', 'publishing.evidence.submit'], accessRepository, now)) return;
      const body = bodyObject(req);
      const result = await quotationService.recordExternalSendEvidence(
        actor,
        draftId(req.params.id),
        idempotencyHeader(req),
        {
          channel: body.channel,
          artifactHash: body.artifactHash,
          providerReference: body.providerReference,
        },
      );
      res.status(201).json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/drafts/:id', async (req, res) => {
    try {
      const actor = await readActor(req, res);
      if (!actor) return;
      if (!await requireCapabilities(res, actor.tenantId, ['quotation.calculate'], accessRepository, now)) return;
      res.json(await quotationService.getDraft(actor, draftId(req.params.id)));
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}

export const starter198QuotationRouter = createStarter198QuotationRouter();
