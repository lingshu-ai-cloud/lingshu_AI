import { Router, type RequestHandler, type ErrorRequestHandler } from 'express';
import type { DataStore } from '../storage/datastore.js';
import type { AuthLocals } from '../middleware/auth.js';
import { readWeeklyCustomerRelationshipScope } from '../socialPrograms/weeklyCustomerRelationshipScope.js';
import { SocialProgramError } from '../socialPrograms/service.js';
export interface NativeDispatchScope { runId: string; programId: string; packageId: string; packageVersion: number }
export interface WeeklyNativeDispatchPort {
  sources(tenantId: string, actorUserId: string, runId: string, expectedScope: NativeDispatchScope): Promise<unknown>;
  dispatch(input: { tenantId: string; actorUserId: string; batchId: string; itemId: string; expectedBatchVersion: number; expectedItemHash: string; expectedScope: NativeDispatchScope }): Promise<unknown>;
}
const invalid = (): never => { throw new SocialProgramError('weekly_native_dispatch_input_invalid', 400, '请核对原周包与审批版本。'); };
const text = (v: unknown): string => typeof v === 'string' && v.trim() && v.length <= 200 && !/[\u0000-\u001f\u007f]/.test(v) ? v.trim() : invalid();
const version = (v: unknown): number => { const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v; return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : invalid(); };
const route = (f: RequestHandler): RequestHandler => (req, res, next) => Promise.resolve(f(req, res, next)).catch(next);
/** Explicit human dispatch only; candidate reads never invoke a send port. */
export function createSocialWeeklyNativeDispatchRouter(store: DataStore, service: WeeklyNativeDispatchPort) {
  const router = Router({ mergeParams: true });
  const scope = async (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], v: unknown, run: unknown) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    if (!tenantId || !userId) throw new SocialProgramError('weekly_native_dispatch_auth_required', 401, '请先登录。');
    const expectedScope = { programId: text(req.params.programId), packageId: text(req.params.packageId), packageVersion: version(v), runId: text(run) };
    const actual = await readWeeklyCustomerRelationshipScope(store, tenantId, expectedScope.runId);
    if (!actual || Object.entries(expectedScope).some(([k, value]) => actual[k as keyof typeof actual] !== value)) throw new SocialProgramError('weekly_native_dispatch_scope_changed', 409, '原运行与当前周包不一致。');
    return { tenantId, actorUserId: userId, expectedScope };
  };
  router.get('/sources', route(async (req, res) => {
    if (Object.keys(req.query).some(k => !['version', 'runId'].includes(k))) return invalid();
    const a = await scope(req, res, req.query.version, req.query.runId);
    res.json({ scope: { tenantId: a.tenantId, ...a.expectedScope }, items: await service.sources(a.tenantId, a.actorUserId, a.expectedScope.runId, a.expectedScope) });
  }));
  router.post('/', route(async (req, res) => {
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(k => !['packageVersion', 'runId', 'batchId', 'itemId', 'expectedBatchVersion', 'expectedItemHash'].includes(k))) return invalid();
    const a = await scope(req, res, b.packageVersion, b.runId);
    res.json(await service.dispatch({ ...a, batchId: text(b.batchId), itemId: text(b.itemId), expectedBatchVersion: version(b.expectedBatchVersion), expectedItemHash: text(b.expectedItemHash) }));
  }));
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof SocialProgramError) { res.status(error.status).json({ code: error.code, error: error.message }); return; }
    if (error instanceof Error && /^weekly_(?:native_dispatch|customer_relationship)_[a-z0-9_]+$/.test(error.message)) { res.status(error.message.includes('actor_forbidden') ? 403 : 409).json({ code: error.message, error: '原审批、会话或周任务证据已变化，请核对原对象。' }); return; }
    next(error);
  };
  router.use(errors); return router;
}
