import { Router, type RequestHandler, type ErrorRequestHandler } from 'express';
import type { DataStore } from '../storage/datastore.js';
import type { AuthLocals } from '../middleware/auth.js';
import { SocialProgramError } from '../socialPrograms/service.js';
import { readWeeklyCustomerChannelOptions, confirmWeeklyCustomerChannelSelection } from '../socialPrograms/weeklyCustomerChannelSelections.js';
const invalid = (): never => { throw new SocialProgramError('weekly_channel_input_invalid', 400, '请提供明确的周包、运行及真实会话选择。'); };
const text = (v: unknown, max = 200): string => typeof v === 'string' && v.trim() && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v) ? v.trim() : invalid();
const version = (v: unknown): number => { const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v; return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : invalid(); };
const route = (f: RequestHandler): RequestHandler => (req, res, next) => Promise.resolve(f(req, res, next)).catch(next);

export function createSocialWeeklyCustomerChannelScopeRouter(store: DataStore) {
  const router = Router({ mergeParams: true });
  const scope = (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], v: unknown, runId: unknown) => {
    const auth = res.locals as AuthLocals;
    if (!auth.tenantId || !auth.userId) throw new SocialProgramError('weekly_channel_auth_required', 401, '请先登录。');
    return { tenantId: auth.tenantId, actorUserId: auth.userId, programId: text(req.params.programId), packageId: text(req.params.packageId), packageVersion: version(v), runId: text(runId) };
  };
  router.get('/', route(async (req, res) => {
    if (Object.keys(req.query).some(k => !['version', 'runId'].includes(k))) return invalid();
    res.json({ item: await readWeeklyCustomerChannelOptions(store, scope(req, res, req.query.version, req.query.runId)) });
  }));
  router.post('/', route(async (req, res) => {
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(k => !['packageVersion', 'runId', 'channel', 'accountId', 'customerId', 'inboundMessageId', 'classification', 'reason'].includes(k))) return invalid();
    if (!['whatsapp', 'messenger', 'instagram'].includes(b.channel) || !['new_inquiry', 'existing_contact'].includes(b.classification)) return invalid();
    const a = scope(req, res, b.packageVersion, b.runId);
    res.status(201).json({ item: await confirmWeeklyCustomerChannelSelection(store, a, {
      runId: a.runId, packageId: a.packageId, packageVersion: a.packageVersion, channel: b.channel,
      accountId: text(b.accountId), customerId: text(b.customerId), inboundMessageId: text(b.inboundMessageId),
      classification: b.classification, reason: text(b.reason, 2000),
    }) });
  }));
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof SocialProgramError) { res.status(error.status).json({ code: error.code, error: error.message }); return; }
    if (error instanceof Error && /^weekly_(?:channel|customer)_[a-z0-9_]+$/.test(error.message)) {
      res.status(error.message.includes('actor_forbidden') ? 403 : 409).json({ code: error.message, error: '真实渠道、周包绑定或入站会话证据尚未满足，请核对原对象。' }); return;
    }
    next(error);
  };
  router.use(errors); return router;
}
