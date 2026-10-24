import type { RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { customerReplyRequestSchema } from '../../shared/contracts/customerReply.js';
import { localPreviewRequestRejection } from '../auth/authIdentityHelpers.js';
import { isBrowserReadToken } from '../digitalEmployees/browserReadSession.js';
import { enforceSupportSessionReadOnly } from '../middleware/auth.js';
import { createCustomerReplyRequests } from './replyRequests.js';
import type { createLocalCustomerSimulation } from './localPreviewSimulation.js';

const mockId = z.string().regex(/^mock-[a-zA-Z0-9_-]{1,150}$/);
const translation = z.strictObject({ customerId: mockId, text: z.string().trim().min(1).max(12000),
  source: z.string().min(1).max(100).default('auto'), target: z.string().trim().min(1).max(100), manualRequest: z.literal(true) });
type Service = ReturnType<typeof createLocalCustomerSimulation>;

/** Keep original HTTP contracts; only local mock actions receive the existing scoped AI capability. */
export function createLocalPreviewReplyCompatibility(load?: () => Promise<Service>) {
  let service: Promise<Service> | undefined;
  const getService = () => service ??= load ? load() : import('./localPreviewSimulation.js').then(m => m.createLocalCustomerSimulation());
  const wrap = (action: RequestHandler): RequestHandler => async (req, res, next) => {
    if (process.env.LINGSHU_LOCAL_PREVIEW !== '1' && process.env.CUSTOMER_SIMULATION_ENABLED !== '1') { next(); return; }
    let origin = req.headers.origin;
    if (!origin && req.method === 'GET') { try { origin = new URL(req.headers.referer || '').origin; } catch { /* fail closed */ } }
    if (process.env.NODE_ENV !== 'development' || process.env.LINGSHU_LOCAL_PREVIEW !== '1' || process.env.CUSTOMER_SIMULATION_ENABLED !== '1'
      || localPreviewRequestRejection(origin, req.socket.remoteAddress)) { res.status(404).json({error:'not_found'}); return; }
    if (res.locals.dataAuthority !== 'local' || isBrowserReadToken(req.headers.authorization)) { res.status(403).json({error:'preview_local_identity_required'}); return; }
    const status = Reflect.get(globalThis, Symbol.for('lingshu.customerIsolationStatus'));
    if (typeof status !== 'function' || !status().installed) { res.status(503).json({error:'customer_isolation_guard_missing'}); return; }
    enforceSupportSessionReadOnly(req, res, () => {
      Promise.resolve(action(req, res, next)).catch(error => {
        res.status(409).json({error:error instanceof Error ? error.message : 'preview_reply_failed'});
      });
    });
  };
  let requests: ReturnType<typeof createCustomerReplyRequests> | undefined;
  const getRequests = async () => {
    const s = await getService();
    return requests ??= createCustomerReplyRequests(s.store, async (body, identity, signal) => {
      const view = await s.start(identity.tenantId, identity.userId, body.customerId);
      return s.generateForReply(await s.session(identity.tenantId, identity.userId, view.sessionId), body, signal);
    });
  };
  return {
    execute: wrap(async (req, res, next) => {
      const parsed = customerReplyRequestSchema.safeParse(req.body);
      if (!parsed.success || !mockId.safeParse(parsed.data.customerId).success || parsed.data.manualRequest !== true) {
        res.status(400).json({error:'preview_manual_mock_reply_required'}); return;
      }
      req.body = {...parsed.data, requestId: parsed.data.requestId ?? randomUUID()};
      await (await getRequests()).execute(req, res, next);
    }),
    read: wrap(async (req, res, next) => { await (await getRequests()).read(req, res, next); }),
    translate: wrap(async (req, res) => {
      const parsed = translation.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({error:'preview_manual_mock_translation_required'}); return; }
      const s = await getService(), {tenantId, userId} = res.locals;
      const view = await s.start(tenantId, userId, parsed.data.customerId);
      const translatedText = await s.translateForReply(await s.session(tenantId, userId, view.sessionId), parsed.data.text, parsed.data.source, parsed.data.target);
      res.json({ok:true, source:'qwen', translatedText});
    }),
  };
}
export const localPreviewReplyCompatibility = createLocalPreviewReplyCompatibility();
