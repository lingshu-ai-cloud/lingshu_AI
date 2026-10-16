import { Router, type RequestHandler } from 'express';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import { requireAuth, enforceSupportSessionReadOnly, type AuthLocals } from '../middleware/auth.js';
import { enterpriseProductIdentity } from '../lib/enterpriseProductIdentity.js';
import { createSocialOperatingRepository } from '../socialOperating/repository.js';
import { createWeeklyOperatingPackageService } from '../socialPrograms/weeklyOperatingPackages.js';
import { SocialProgramError } from '../socialPrograms/service.js';
import { createWeeklyContentActions, type WeeklyContentActionInput } from '../assistant/weeklyContentActions.js';
import { createWeeklyExistingActions, type WeeklyExistingActionScope } from '../assistant/weeklyExistingActions.js';
import { socialJson, socialObject } from '../starter198/socialContentValidation.js';
import type { WeeklyOperatingPackage } from '../../shared/contracts/socialProgram.js';
import { createLegacyWeeklyExistingActions, type LegacyWeeklyTarget } from '../assistant/legacyWeeklyExistingActions.js';
import { reconcileDigitalEmployeeRun } from './digitalEmployees.js';
import { invalidatePublishingApprovalForProject, invalidatePublishingAuthorizationForRun } from '../digitalEmployees/publishingExecution.js';
import { type LegacyWeeklyCreateInput } from '../assistant/legacyWeeklyContentActions.js';
import { createIndependentWeeklyContent } from '../assistant/independentWeeklyContent.js';
import { readLegacyWeeklyPackages } from '../assistant/legacyWeeklyContext.js';

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
function navigation(programId: string, packageId: string, version: number, extra: Record<string, string> = {}) {
  const query = new URLSearchParams({ page: 'digitalEmployees', weeklyView: 'production', weeklyProgramId: programId, weeklyPackageId: packageId, weeklyPackageVersion: String(version), ...extra });
  return { page: 'digitalEmployees', href: `/?${query}` };
}
function inputBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SocialProgramError('assistant_weekly_input_invalid', 400, '操作参数无效，请重新选择任务。');
  const input = value as Record<string, unknown>;
  if (['tenantId', 'userId', 'actorUserId', 'role', 'authorization'].some(key => key in input)) throw new SocialProgramError('assistant_weekly_identity_invalid', 400, '请使用当前登录身份操作。');
  return input;
}
function readableFailure(error: { code?: string; message?: string }) {
  if (error.message && /[\u3400-\u9fff]/u.test(error.message)) return error.message;
  const code = error.code || '';
  if (/capacity|budget|quota/.test(code)) return '当前容量、预算或可用时间不足，请在周任务中核对后重新排期。原任务未被报告为完成。';
  if (/version|stale|changed/.test(code)) return '周任务或交付物已更新，请重新读取最新版本后再确认。';
  if (/review|approval|director/.test(code)) return '这项任务还需要完成编导审核或用户确认，请在原周任务中处理。';
  if (/fact|material|source/.test(code)) return '这项任务缺少已确认的资料或素材，请在原周任务中补齐。';
  if (/forbidden|permission/.test(code)) return '当前账号无权执行这项周任务操作，请联系负责人确认。';
  return '当前任务条件尚未满足，请查看原周任务的阻塞原因后继续。';
}
export function createAssistantWeeklyActionsRouter(dataStore: DataStore = store, authMiddleware: RequestHandler = requireAuth) {
  const router = Router();
  router.use(authMiddleware);
  router.use(enforceSupportSessionReadOnly);
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
  const content = createWeeklyContentActions(dataStore), existing = createWeeklyExistingActions(dataStore);
  const connectedLegacyAccounts = async (tenantId: string) => {
    const [social, youtube] = await Promise.all([dataStore.list<Record_>('social_accounts', { where: { tenantId }, perPage: 500 }), dataStore.list<Record_>('youtube_accounts', { where: { tenantId }, perPage: 500 })]);
    if (social.totalItems !== social.items.length || youtube.totalItems !== youtube.items.length) throw new SocialProgramError('assistant_weekly_accounts_incomplete', 409, '发布账号过多，请从具体账号进入。');
    const socialAccounts = social.items.filter(a => a.tenantId === tenantId && a.status === 'connected' && ['tiktok', 'instagram', 'facebook'].includes(text(a.platform))).map(a => ({ accountId: a.id, accountLabel: text(a.title) || text(a.handle) || a.id, platform: text(a.platform), status: 'connected' }));
    const youtubeAccounts = youtube.items.filter(a => a.tenantId === tenantId && a.status === 'connected').map(a => ({ accountId: a.id, accountLabel: text(a.channelTitle) || a.id, platform: 'youtube', status: 'connected' }));
    return [...socialAccounts, ...youtubeAccounts];
  };
  const legacyExisting = createLegacyWeeklyExistingActions(dataStore, { wakeRun: reconcileDigitalEmployeeRun, invalidateProject: invalidatePublishingApprovalForProject, invalidateRun: invalidatePublishingAuthorizationForRun, connectedAccounts: connectedLegacyAccounts });
  const legacyContent = createIndependentWeeklyContent(dataStore);
  const packages = createWeeklyOperatingPackageService(dataStore);
  const route = (handler: (req: any, res: any) => Promise<void>) => async (req: any, res: any) => {
    try { await handler(req, res); }
    catch (error) {
      const e = error as { code?: string; status?: number; message?: string };
      const known = error instanceof SocialProgramError;
      res.status(known ? e.status || 409 : 503).json({ error: known ? e.code : 'assistant_weekly_unavailable', message: known ? readableFailure(e) : '周任务服务暂时不可用，请先查看原任务状态，勿重复提交。' });
    }
  };
  const scope = (res: any) => { const identity = res.locals as AuthLocals; return { tenantId: identity.tenantId, userId: identity.userId }; };
  const existingScope = (res: any, b: Record<string, unknown>): WeeklyExistingActionScope => ({ ...scope(res), programId: text(b.programId), packageId: text(b.packageId), packageVersion: Number(b.packageVersion), publicationTaskId: text(b.publicationTaskId), taskId: text(b.taskId), artifactId: text(b.artifactId), expectedArtifactVersion: text(b.expectedArtifactVersion) });
  const legacyTarget = (b: Record<string, unknown>): LegacyWeeklyTarget => ({ model: 'legacy', goalId: text(b.goalId), planId: text(b.planId), planVersion: Number(b.planVersion), runId: text(b.runId), taskId: text(b.taskId), projectId: text(b.projectId), expectedHash: text(b.expectedHash) });
  const legacyReceipt = (item: { goalId?: string; planId: string; planVersion: number; runId: string; navigation: string }, b: Record<string, unknown>) => ({ ...item, programId: text(b.goalId), packageId: item.planId, packageVersion: item.planVersion, navigation: { page: 'smartAssets', href: item.navigation } });
  router.get('/context', route(async (_req, res) => {
    const { tenantId } = scope(res);
    const rows = await dataStore.list<Record_>('social_weekly_operating_packages', { where: { tenant_id: tenantId }, perPage: 1000 });
    if (rows.items.length !== rows.totalItems) throw new SocialProgramError('assistant_weekly_context_too_large', 409, '周任务过多，请从具体周计划进入。');
    const latest = new Map<string, WeeklyOperatingPackage>();
    for (const row of rows.items) {
      if (row.tenant_id !== tenantId) continue;
      const pkg = socialObject(socialJson(row.payload)) as unknown as WeeklyOperatingPackage | null;
      if (!pkg || !pkg.programId || !pkg.packageId) continue;
      const key = `${pkg.programId}:${pkg.packageId}`;
      if (!latest.has(key) || latest.get(key)!.version < pkg.version) latest.set(key, pkg);
    }
    const available = [...latest.values()].filter(pkg => pkg.status === 'draft' || pkg.status === 'active');
    const profileRows = await dataStore.list<Record_>('tenant_profiles', { where: { tenant_id: tenantId }, perPage: 2 });
    if (profileRows.totalItems > 1) throw new SocialProgramError('assistant_weekly_profile_ambiguous', 409, '企业知识库存在多个版本，请先确认当前资料。');
    const profile = socialObject(socialJson(profileRows.items[0]?.profile));
    const productRows = socialObject(profile?.products)?.items;
    const products = (Array.isArray(productRows) ? productRows : []).map((value, index) => {
      const product = socialObject(value) ?? {};
      return { id: enterpriseProductIdentity(product, index), name: text(product.name) };
    }).filter(p => p.name);
    const productIds = new Map<string, string[]>();
    for (const pkg of available) {
      const ref = pkg.businessContentGoalRef;
      const goal = ref ? await createSocialOperatingRepository(dataStore).getGoal(tenantId, pkg.programId, ref.id, ref.version) : null;
      const primary = goal?.products[0];
      productIds.set(`${pkg.programId}:${pkg.packageId}`, products.filter(p => p.id === primary || p.name === primary).map(p => p.id));
    }
    const accounts = new Map<string, { id: string; name: string; programId: string; platform: string; packageIds: string[] }>();
    for (const pkg of available) for (const pub of pkg.socialContentPackage.publicationTasks) {
      const key = `${pkg.programId}:${pub.accountId}`, previous = accounts.get(key);
      accounts.set(key, { id: pub.accountId, name: `${pub.platform} · ${pub.accountPositioning || pub.accountId}`, programId: pkg.programId, platform: pub.platform, packageIds: [...new Set([...(previous?.packageIds ?? []), pkg.packageId])] });
    }
    const taskRows = await dataStore.list<Record_>('starter_social_content_tasks', { where: { tenant_id: tenantId }, perPage: 1000 });
    const artifactRows = await dataStore.list<Record_>('starter_social_content_artifacts', { where: { tenant_id: tenantId }, perPage: 1000 });
    if (taskRows.items.length !== taskRows.totalItems || artifactRows.items.length !== artifactRows.totalItems) throw new SocialProgramError('assistant_weekly_context_too_large', 409, '交付物过多，请从具体周任务进入。');
    const revisionTargets: Record<string, unknown>[] = [], publishTargets: Record<string, unknown>[] = [];
    for (const task of taskRows.items) {
      const brief = socialObject(socialJson(task.brief));
      const authority = socialObject(brief?._weeklyAuthority), week = socialObject(authority?.weeklyPackage), pub = socialObject(authority?.publicationTask);
      const pkg = available.find(p => p.packageId === task.weekly_plan_id && p.programId === week?.programId && p.version === week?.version);
      if (!pkg || !pub?.publicationTaskId) continue;
      for (const artifact of artifactRows.items.filter(a => a.task_id === task.task_id)) {
        const artifactContent = socialObject(socialJson(artifact.content));
        const target = { id: `${task.task_id}:${artifact.artifact_id}`, name: `${text(artifact.title) || text(artifact.kind) || '内容交付物'} · ${String(artifact.version)}`, programId: pkg.programId, packageId: pkg.packageId, packageVersion: pkg.version, publicationTaskId: pub.publicationTaskId, taskId: task.task_id, artifactId: artifact.artifact_id, expectedArtifactVersion: String(artifact.version) };
        if (artifact.status === 'review_required') revisionTargets.push(target);
        if (pkg.status === 'active' && pkg.socialContentPackage.authorization?.allowRealPublishing && artifact.status === 'approved' && socialObject(artifactContent?.productionResult)?.productionResultId) publishTargets.push(target);
      }
    }
    const legacy = await legacyExisting.list(scope(res));
    const legacyPackages = await readLegacyWeeklyPackages(dataStore, tenantId);
    const legacyTargets = (targets: typeof legacy.revisionTargets) => targets.map(t => ({ ...t, programId: t.goalId, packageId: t.planId, packageVersion: t.planVersion }));
    res.json({ item: { packages: [...legacyPackages, ...available.map(p => ({ programId: p.programId, packageId: p.packageId, packageVersion: p.version, allowedProductIds: productIds.get(`${p.programId}:${p.packageId}`) ?? [], title: `${p.weekStart} 至 ${p.weekEnd} · 第 ${p.version} 版` }))], products, accounts: [...accounts.values()], publishingAccounts: await connectedLegacyAccounts(tenantId), revisionTargets: [...legacyTargets(legacy.revisionTargets), ...revisionTargets], publishTargets: [...legacyTargets(legacy.publishTargets), ...publishTargets] } });
  }));
  const createInput = (b: Record<string, unknown>): WeeklyContentActionInput => ({ requestId: text(b.requestId), programId: text(b.programId), packageId: text(b.packageId), expectedVersion: Number(b.packageVersion ?? b.expectedVersion), accountId: text(b.accountId), productId: text(b.productId), goal: text(b.goal), platform: text(b.platform) as WeeklyContentActionInput['platform'], dueAt: text(b.dueAt), ...(b.capacityPlanRef ? { capacityPlanRef: b.capacityPlanRef as any } : {}), ...(b.operatingDecisionSnapshotRef ? { operatingDecisionSnapshotRef: b.operatingDecisionSnapshotRef as any } : {}), ...(b.capacityAuthorization ? { capacityAuthorization: b.capacityAuthorization as any } : {}) });
  router.post('/create/capacity/preview', route(async (req, res) => { const b = inputBody(req.body); res.json({ item: await content.proposeCapacity(scope(res), createInput(b)) }); }));
  router.post('/create/capacity/confirm', route(async (req, res) => { const b = inputBody(req.body); res.json({ item: await content.confirmCapacity(scope(res), createInput(b), b.confirmation as any) }); }));
  router.post('/create/schedule-input', route(async (req, res) => { const b = inputBody(req.body); res.json({ item: await content.scheduleInput(scope(res), createInput(b)) }); }));
  router.post('/create', route(async (req, res) => {
    const b = inputBody(req.body);
    if (b.model === 'legacy') {
      const input: LegacyWeeklyCreateInput = { requestId: text(b.requestId), goalId: text(b.goalId), planId: text(b.planId), runId: text(b.runId), expectedPlanHash: text(b.expectedPlanHash), productId: text(b.productId), goal: text(b.goal), platform: text(b.platform) as LegacyWeeklyCreateInput['platform'], dueAt: text(b.dueAt), maximumAdditionalCostCny: Number(b.maximumAdditionalCostCny), confirmAdditionalBudget: b.confirmAdditionalBudget === true, acknowledgePublishingRevocation: b.acknowledgePublishingRevocation === true, publishMode: b.publishMode as 'draft_only' };
      const item = await legacyContent.create(scope(res), input);
      res.status(201).json({ item: { ...item, programId: input.goalId, packageId: item.planId, packageVersion: item.planVersion, navigation: item.navigation } }); return;
    }
    const input = createInput(b);
    const item = await content.create(scope(res), input);
    res.status(201).json({ item: { ...item, navigation: navigation(input.programId, input.packageId, Number(item.packageVersion), { weeklyPublicationTaskId: item.publicationTaskId }) } });
  }));
  router.post('/create/graph', route(async (req, res) => { const b = inputBody(req.body); res.json({ item: await content.graph(scope(res), createInput(b)) }); }));
  router.post('/create/preview', route(async (req, res) => { const b = inputBody(req.body); res.json({ item: await content.preview(scope(res), createInput(b), b.capacity as any) }); }));
  router.post('/create/confirm', route(async (req, res) => { const b = inputBody(req.body); const input = createInput(b); const item = await content.confirm(scope(res), input, b.confirmation as any); res.json({ item: { ...item, navigation: navigation(input.programId, input.packageId, Number(item.packageVersion), { weeklyPublicationTaskId: item.publicationTaskId }) } }); }));
  router.post('/revise', route(async (req, res) => {
    const b = inputBody(req.body);
    if (b.model === 'legacy') { const item = await legacyExisting.prepareRevision(scope(res), legacyTarget(b)); res.json({ item: legacyReceipt(item, b) }); return; }
    const s = existingScope(res, b);
    const item = await existing.requestRevision(s, { requestId: text(b.requestId), note: text(b.note ?? b.goal) });
    res.status(201).json({ item: { ...item, programId: s.programId, packageId: s.packageId, packageVersion: s.packageVersion, navigation: navigation(s.programId, s.packageId, s.packageVersion, { weeklyPublicationTaskId: s.publicationTaskId, weeklyRepairCaseId: item.case.caseId }) } });
  }));
  router.post('/publish', route(async (req, res) => { const b = inputBody(req.body); if (b.model === 'legacy') { const item = b.confirmPublishingIntent === true ? await legacyExisting.configurePublish(scope(res), legacyTarget(b), { accountId: text(b.accountId), publishAt: text(b.publishAt), confirmPublishingIntent: true }) : await legacyExisting.publish(scope(res), legacyTarget(b)); res.json({ item: legacyReceipt(item, b) }); return; } const s = existingScope(res, b); const item = await existing.preparePublish(s); res.json({ item: { ...item, programId: s.programId, navigation: navigation(s.programId, s.packageId, s.packageVersion, { weeklyPublicationTaskId: s.publicationTaskId, weeklyTaskId: item.executionTaskId }) } }); }));
  return router;
}
export const assistantWeeklyActionsRouter = createAssistantWeeklyActionsRouter();
