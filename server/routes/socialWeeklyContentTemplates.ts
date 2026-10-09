import { Router, type RequestHandler, type ErrorRequestHandler } from 'express';
import type { AuthLocals } from '../middleware/auth.js';
import type { DataStore, Record_ } from '../storage/datastore.js';
import type { VersionedSocialRef } from '../../shared/contracts/socialProgram.js';
import { CONTENT_TEMPLATE_CANDIDATES, createWeeklyContentTemplateService } from '../socialPrograms/weeklyContentTemplates.js';
import { SocialProgramError } from '../socialPrograms/service.js';
import { SocialContentWorkflowError } from '../starter198/socialContentValidation.js';
import { createWeeklyOperatingPackageService } from '../socialPrograms/weeklyOperatingPackages.js';
import { createWeeklyContentTemplateApplicationService } from '../socialPrograms/weeklyContentTemplateApplications.js';

const invalid = (): never => { throw new SocialProgramError('content_template_body_invalid', 400, '请选择真实成片、复盘凭据、适用条件及目标周版本。'); };
const text = (value: unknown, max = 2000): string => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : invalid();
const integer = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : invalid();
const queryInteger = (value: unknown): number => typeof value === 'string' && /^[1-9]\d*$/.test(value) ? integer(Number(value)) : invalid();
function body(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) return invalid();
  return value as Record<string, unknown>;
}
function ref(value: unknown, type: string): VersionedSocialRef {
  const item = body(value, ['type', 'id', 'version']);
  if (item.type !== type) return invalid();
  return { type, id: text(item.id, 150), version: integer(item.version) };
}
const list = (value: unknown, required = false): string[] => Array.isArray(value) && value.length <= 30 && (!required || value.length > 0) ? value.map(item => text(item, 500)) : invalid();
const route = (handler: RequestHandler): RequestHandler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

/** Parent authenticates and verifies the actual program before entering this router. */
export function createSocialWeeklyContentTemplatesRouter(store: DataStore) {
  const router = Router({ mergeParams: true });
  const service = createWeeklyContentTemplateService(store);
  const packages = createWeeklyOperatingPackageService(store);
  const applications = createWeeklyContentTemplateApplicationService(store);
  const scope = (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) => {
    const actor = res.locals as AuthLocals;
    if (!actor.tenantId || !actor.userId) throw new SocialProgramError('content_template_auth_required', 401, '请登录后操作内容模板。');
    return { tenantId: actor.tenantId, programId: text(req.params.programId, 100), actorUserId: actor.userId };
  };
  router.get('/', route(async (req, res) => {
    const a = scope(req, res);
    const page = req.query.page === undefined ? 1 : integer(/^\d+$/.test(String(req.query.page)) ? Number(req.query.page) : undefined);
    const rows = await store.list<Record_>(CONTENT_TEMPLATE_CANDIDATES, { where: { tenant_id: a.tenantId, program_id: a.programId }, page, perPage: 50, sort: 'id' });
    const items = await Promise.all(rows.items.map(row => service.candidateRead(a, { type: 'weekly_content_template', id: String(row.template_id), version: Number(row.template_version) })));
    res.json({ items, page: rows.page, perPage: rows.perPage, totalItems: rows.totalItems, totalPages: rows.totalPages });
  }));
  router.post('/', route(async (req, res) => {
    const a = scope(req, res), input = body(req.body, ['sourceTaskId', 'reviewRef', 'action', 'previousRef', 'title', 'reason', 'applicability']);
    const applicability = body(input.applicability, ['platform', 'audience', 'productScope', 'replaceFacts', 'prohibited']);
    if (!['new', 'retain', 'revise'].includes(String(input.action)) || !['tiktok', 'facebook', 'instagram', 'youtube'].includes(String(applicability.platform))) return invalid();
    const item = await service.create(a, { actorUserId: a.actorUserId, sourceTaskId: text(input.sourceTaskId, 150), reviewRef: ref(input.reviewRef, 'weekly_review_snapshot'), action: input.action as 'new' | 'retain' | 'revise', ...(input.previousRef === undefined ? {} : { previousRef: ref(input.previousRef, 'weekly_content_template') }), title: text(input.title, 200), reason: text(input.reason), applicability: { platform: String(applicability.platform), audience: text(applicability.audience, 1000), productScope: text(applicability.productScope, 1000), replaceFacts: list(applicability.replaceFacts, true), prohibited: list(applicability.prohibited) } });
    res.status(201).json({ item });
  }));
  router.get('/confirmation', route(async (req, res) => {
    const a = scope(req, res), query = body(req.query, ['templateId', 'templateVersion']);
    res.json({ item: await service.readConfirmation(a, { type: 'weekly_content_template', id: text(query.templateId, 150), version: queryInteger(query.templateVersion) }) });
  }));
  router.get('/execution-selection', route(async (req, res) => {
    const a = scope(req, res), query = body(req.query, ['taskId']);
    res.json({ item: await service.readExecutionSelection(a, text(query.taskId, 150)) });
  }));
  router.post('/execution-selection', route(async (req, res) => {
    const a = scope(req, res), input = body(req.body, ['taskId', 'templateRef', 'candidateHash']);
    res.json({ item: await service.selectExecutionCandidate(a, { taskId: text(input.taskId, 150), templateRef: ref(input.templateRef, 'weekly_content_template'), candidateHash: text(input.candidateHash, 64) }) });
  }));
  router.post('/execution-resume', route(async (req, res) => {
    const a = scope(req, res), input = body(req.body, ['taskId']);
    res.json({ item: await service.resumeExecution(a, { taskId: text(input.taskId, 150) }) });
  }));
  router.get('/pending-binding', route(async (req, res) => {
    const a = scope(req, res), query = body(req.query, ['packageId', 'expectedPackageVersion', 'expectedTargetVersion', 'publicationTaskId', 'templateId', 'templateVersion', 'candidateHash', 'bindingId']);
    res.json({ item: await service.readPendingBinding({ tenantId: a.tenantId, programId: a.programId, packageId: text(query.packageId, 150), packageVersion: queryInteger(query.expectedPackageVersion), publicationTaskId: text(query.publicationTaskId, 150) }, { actorUserId: a.actorUserId, templateRef: { type: 'weekly_content_template', id: text(query.templateId, 150), version: queryInteger(query.templateVersion) }, candidateHash: text(query.candidateHash, 64), expectedTargetVersion: queryInteger(query.expectedTargetVersion), ...(query.bindingId === undefined ? {} : { bindingId: text(query.bindingId, 150) }) }) });
  }));
  router.post('/confirm', route(async (req, res) => {
    const a = scope(req, res), input = body(req.body, ['templateRef', 'candidateHash', 'usage', 'reason']);
    if (!['trial', 'retain'].includes(String(input.usage))) return invalid();
    res.json({ item: await service.confirm(a, { actorUserId: a.actorUserId, templateRef: ref(input.templateRef, 'weekly_content_template'), candidateHash: text(input.candidateHash, 64), usage: input.usage as 'trial' | 'retain', reason: text(input.reason) }) });
  }));
  router.post('/apply', route(async (req, res) => {
    const a = scope(req, res), input = body(req.body, ['bindingId', 'sourceVersion', 'targetVersion']);
    res.json(await applications.apply(a, { bindingId: text(input.bindingId, 150), sourceVersion: integer(input.sourceVersion), targetVersion: integer(input.targetVersion) }));
  }));
  router.post('/bind', route(async (req, res) => {
    const a = scope(req, res), input = body(req.body, ['packageId', 'expectedPackageVersion', 'expectedTargetVersion', 'publicationTaskId', 'templateRef', 'candidateHash']);
    const packageId = text(input.packageId, 150), expectedPackageVersion = integer(input.expectedPackageVersion), expectedTargetVersion = integer(input.expectedTargetVersion);
    const actual = await packages.get(a.tenantId, a.programId, packageId);
    if (actual.version !== expectedPackageVersion || expectedTargetVersion !== expectedPackageVersion + 1) throw new SocialProgramError('package_version_conflict', 409, '目标草稿已变化，请重新读取当前版本。');
    const item = await service.bind({ tenantId: a.tenantId, programId: a.programId, packageId, packageVersion: actual.version, publicationTaskId: text(input.publicationTaskId, 150) }, { actorUserId: a.actorUserId, expectedTargetVersion, templateRef: ref(input.templateRef, 'weekly_content_template'), candidateHash: text(input.candidateHash, 64) });
    res.json({ item, publicationPatch: { publicationTaskId: item.publicationTaskId, contentTemplateBindingRef: { type: 'weekly_content_template_binding', id: item.bindingId, version: 1 } }, planningRevisionRequired: true });
  }));
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof SocialProgramError || error instanceof SocialContentWorkflowError) { res.status(error.status).json({ error: error.code, message: error.message }); return; }
    next(error);
  };
  router.use(errors);
  return router;
}
