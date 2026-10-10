import { supplementConsumerHash } from '../socialPrograms/weeklySupplementRequests.js';
import type { WeeklyExecutionTask } from '../../shared/contracts/socialProgram.js';
import { Router, type RequestHandler, type ErrorRequestHandler } from 'express';
import type { DataStore, Record_ } from '../storage/datastore.js';
import type { AuthLocals } from '../middleware/auth.js';
import { organizationRoleOrNull } from '../lib/organizationRole.js';
import { SocialProgramError } from '../socialPrograms/service.js';
import { socialJson, socialObject } from '../starter198/socialContentValidation.js';
import { bindWeeklyPreproductionAuthority, listWeeklyPreproductionJobs } from '../runtime/weeklyPreproductionProducer.js';
import { listWeeklyMetricCollectionJobs } from '../runtime/weeklyPublicationMetricProducer.js';
import { listWeeklyTemplateExtractionJobs } from '../runtime/weeklyContentTemplateCandidateProducer.js';

/** Only POST binds authority. GET never scans, produces, repairs or mutates tasks. */
export function createSocialWeeklyProducerEvidenceRouter(store: DataStore) {
  const router = Router({ mergeParams: true });
  const handle = (bind: boolean): RequestHandler => (req, res, next) => { void (async () => {
    const auth = res.locals as AuthLocals;
    if (!auth.tenantId || !auth.userId) throw new SocialProgramError('weekly_producer_auth_required', 401, '请登录后读取执行证据。');
    const member = await store.getById<Record_>('users', auth.userId);
    if (!member || member.tenantId !== auth.tenantId || !organizationRoleOrNull(member.role) || member.active === false || member.disabled === true || ['disabled', 'suspended'].includes(String(member.status))) throw new SocialProgramError('weekly_producer_actor_invalid', 403, '当前用户不能操作此租户周任务。');
    const raw = bind ? req.body?.packageVersion : req.query.version;
    const version = !bind && typeof raw === 'string' && /^[1-9]\d*$/.test(raw) ? Number(raw) : raw;
    if (!Number.isSafeInteger(version) || Number(version) < 1 || !bind && Object.keys(req.query).some(k => k !== 'version')) throw new SocialProgramError('weekly_producer_version_invalid', 400, '请选择明确周版本。');
    const scope = { store, tenantId: auth.tenantId, actorUserId: auth.userId, programId: req.params.programId, packageId: req.params.packageId, packageVersion: Number(version) };
    const packages = await store.list<Record_>('social_weekly_operating_packages', { where: { tenant_id: scope.tenantId, program_id: scope.programId, package_id: scope.packageId, version: scope.packageVersion }, page: 1, perPage: 2 });
    const pkg = socialObject(socialJson(packages.items[0]?.payload));
    if (packages.totalItems !== 1 || packages.items.length !== 1 || !pkg || pkg.programId !== scope.programId || pkg.packageId !== scope.packageId || pkg.version !== scope.packageVersion) throw new SocialProgramError('weekly_producer_package_missing', 409, '当前周包版本不存在。');
    res.setHeader('Cache-Control', 'private, no-store');
    if (bind) {
      const body = req.body;
      if (!body || Object.keys(body).some(k => !['packageVersion', 'taskId', 'kind', 'expectedConsumerInputHash', 'discovery'].includes(k)) || typeof body.taskId !== 'string' || !body.taskId || !['outline', 'discovery'].includes(body.kind) || typeof body.expectedConsumerInputHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedConsumerInputHash)) throw new SocialProgramError('weekly_producer_binding_invalid', 400, '前置执行绑定参数无效。');
      if (body.kind === 'discovery') {
        const d = body.discovery;
        if (!d || typeof d !== 'object' || Array.isArray(d) || Object.keys(d).some(k => !['scopeId', 'scopeVersion', 'requestedModes'].includes(k)) || typeof d.scopeId !== 'string' || !d.scopeId || !Number.isSafeInteger(d.scopeVersion) || d.scopeVersion < 1 || !Array.isArray(d.requestedModes) || !d.requestedModes.length || new Set(d.requestedModes).size !== d.requestedModes.length || d.requestedModes.some((m: unknown) => typeof m !== 'string' || !['momentum', 'account', 'innovation'].includes(m))) throw new SocialProgramError('weekly_producer_discovery_binding_invalid', 400, '采集授权范围和版本无效。');
      } else if (body.discovery !== undefined) throw new SocialProgramError('weekly_producer_binding_invalid', 400, '经营基础任务不能绑定采集授权。');
      res.json({ item: await bindWeeklyPreproductionAuthority({ ...scope, taskId: body.taskId, kind: body.kind, expectedConsumerInputHash: body.expectedConsumerInputHash, discovery: body.discovery }) });
      return;
    }
    const [preproduction, metrics, templates] = await Promise.all([listWeeklyPreproductionJobs(scope), listWeeklyMetricCollectionJobs(scope), listWeeklyTemplateExtractionJobs(scope)]);
    const consumers = await store.list<Record_>('social_weekly_execution_tasks', { where: { tenant_id: scope.tenantId, program_id: scope.programId, package_id: scope.packageId, package_version: scope.packageVersion }, page: 1, perPage: 500 });
    if (consumers.totalItems !== consumers.items.length) throw new SocialProgramError('weekly_producer_consumers_incomplete', 409, '原周任务读取不完整。');
    const bindingOptions = consumers.items.flatMap(row => {
      const task = socialObject(socialJson(row.payload)) as unknown as WeeklyExecutionTask;
      if (!task || task.tenantId !== scope.tenantId || task.programId !== scope.programId || task.packageId !== scope.packageId || task.packageVersion !== scope.packageVersion || row.task_id !== task.taskId) throw new SocialProgramError('weekly_producer_consumer_changed', 409, '原周任务身份已变化。');
      if (!['business_outline', 'benchmark_collection'].includes(task.schedule.stepKind) || !['queued', 'blocked'].includes(task.status) || task.lease) return [];
      return [{ taskId: task.taskId, kind: task.schedule.stepKind === 'business_outline' ? 'outline' : 'discovery', expectedConsumerInputHash: supplementConsumerHash(task) }];
    });
    res.json({ items: { preproduction, metrics, templates }, bindingOptions });
  })().catch(next); };
  router.get('/', handle(false));
  router.post('/preproduction-authority', handle(true));
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof SocialProgramError) { res.status(error.status).json({ error: error.code, message: error.message }); return; }
    next(error);
  };
  router.use(errors);
  return router;
}
