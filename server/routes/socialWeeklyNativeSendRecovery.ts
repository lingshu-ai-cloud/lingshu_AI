import { Router, type RequestHandler, type ErrorRequestHandler } from 'express';
import type { AuthLocals } from '../middleware/auth.js';
import type { WeeklyCustomerAuthority } from '../runtime/socialWeeklyCustomerBridge.js';
import { SocialProgramError } from '../socialPrograms/service.js';

export interface WeeklyNativeSendRecoveryPort {
  list(authority: WeeklyCustomerAuthority, actor: string): Promise<unknown>;
  sources(authority: WeeklyCustomerAuthority, actor: string): Promise<unknown>;
  get(authority: WeeklyCustomerAuthority, id: string, actor: string): Promise<unknown>;
  create(authority: WeeklyCustomerAuthority, actor: string, input: {
    channel: 'messenger' | 'instagram'; requestId: string; ownerUserId: string; deadlineAt: string; reason: string;
  }): Promise<unknown>;
  resolve(authority: WeeklyCustomerAuthority, id: string, actor: string, input: { expectedVersion: number }): Promise<unknown>;
}
const invalid = (): never => { throw new SocialProgramError('weekly_native_recovery_input_invalid', 400, '请提供明确的周包版本与原发送异常处理信息。'); };
const text = (v: unknown): string => typeof v === 'string' && v.trim() && v.length <= 2000 && !/[\u0000-\u001f\u007f]/.test(v) ? v.trim() : invalid();
const version = (v: unknown): number => {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : invalid();
};
const body = (v: unknown, keys: string[]): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) return invalid();
  return v as Record<string, unknown>;
};
const route = (f: RequestHandler): RequestHandler => (req, res, next) => Promise.resolve(f(req, res, next)).catch(next);

/** Service alone verifies signed receipts; this route accepts no caller-supplied send proof. */
export function createSocialWeeklyNativeSendRecoveryRouter(service: WeeklyNativeSendRecoveryPort) {
  const router = Router({ mergeParams: true });
  const scope = (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], v: unknown) => {
    const auth = res.locals as AuthLocals;
    if (!auth.tenantId || !auth.userId) throw new SocialProgramError('weekly_native_recovery_auth_required', 401, '请先登录。');
    return { authority: { tenantId: auth.tenantId, programId: text(req.params.programId), packageId: text(req.params.packageId), packageVersion: version(v) }, actor: auth.userId };
  };
  router.get('/', route(async (req, res) => { const a = scope(req, res, req.query.version); res.json({ items: await service.list(a.authority, a.actor) }); }));
  router.get('/sources', route(async (req, res) => { const a = scope(req, res, req.query.version); res.json(await service.sources(a.authority, a.actor)); }));
  router.get('/:id', route(async (req, res) => { const a = scope(req, res, req.query.version); res.json({ item: await service.get(a.authority, text(req.params.id), a.actor) }); }));
  router.post('/', route(async (req, res) => {
    const b = body(req.body, ['packageVersion', 'channel', 'requestId', 'ownerUserId', 'deadlineAt', 'reason']);
    if (!['messenger', 'instagram'].includes(String(b.channel))) return invalid();
    const a = scope(req, res, b.packageVersion), deadlineAt = text(b.deadlineAt);
    if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(deadlineAt) || !Number.isFinite(Date.parse(deadlineAt))) return invalid();
    res.status(201).json({ item: await service.create(a.authority, a.actor, {
      channel: b.channel as 'messenger' | 'instagram', requestId: text(b.requestId), ownerUserId: text(b.ownerUserId), deadlineAt, reason: text(b.reason),
    }) });
  }));
  router.post('/:id/resolve', route(async (req, res) => {
    const b = body(req.body, ['packageVersion', 'expectedVersion']), a = scope(req, res, b.packageVersion);
    res.json(await service.resolve(a.authority, text(req.params.id), a.actor, { expectedVersion: version(b.expectedVersion) }));
  }));
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof SocialProgramError) { res.status(error.status).json({ error: error.message, code: error.code }); return; }
    if (error instanceof Error && /^weekly_native_(?:recovery|dispatch)_[a-z0-9_]+$/.test(error.message)) { res.status(error.message.includes('forbidden') || error.message.includes('owner_required') ? 403 : 409).json({ code: error.message, error: '原发送凭证或处理权限未满足，请只读核对原记录。' }); return; }
    next(error);
  };
  router.use(errors);
  return router;
}
