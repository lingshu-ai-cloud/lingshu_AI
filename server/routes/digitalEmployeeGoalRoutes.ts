import { listTenantEmployees } from './auth.js';

import { type AuthLocals } from '../middleware/auth.js';
import { type EnterpriseProfile } from './enterprise.js';
import { configurationSnapshot, enterpriseProfileFromKnowledgeBinding } from '../digitalEmployees/configuration.js';

import { buildWeeklyPlan, normalizeWeeklyGoal, validateWeeklyGoal } from '../digitalEmployees/domain.js';
import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, jsonObject, type GoalRecord, type PlanRecord, type StoredRecord } from '../digitalEmployees/records.js';
import type { DigitalEmployeeApplicationPorts } from '../digitalEmployees/applicationPorts.js';
import { contentGenerationAuthorization } from '../../shared/contracts/contentGenerationAuthorization.js';
import { isContentProductionPlatform } from '../../shared/contracts/contentProductionPlatforms.js';
import { store } from '../storage/index.js';
import { weeklyReferenceCreationGate } from '../digitalEmployees/weeklyReferenceCreationGate.js';
import { bindWeeklyImageReferences, weeklyImageProductShortage } from '../digitalEmployees/weeklyImageReferences.js';
import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';

export function createDigitalEmployeeGoalRoutes(deps: Pick<DigitalEmployeeApplicationPorts, 'digitalEmployeesRouter' | 'configForTenant' | 'resolveCurrentConfiguration' | 'requiredCreate' | 'recommendPackageWithTenantEvidence' | 'appendAudit' | 'buildOverview' | 'approveGoalForReview'>) {
  const digitalEmployeesRouter = deps.digitalEmployeesRouter;

  const configForTenant: DigitalEmployeeApplicationPorts['configForTenant'] = (...args) => deps.configForTenant(...args);

  const resolveCurrentConfiguration: DigitalEmployeeApplicationPorts['resolveCurrentConfiguration'] = (...args) => deps.resolveCurrentConfiguration(...args);

  function requiredCreate<T extends StoredRecord>(collection: string, payload: Record<string, unknown>): Promise<T> {
    return deps.requiredCreate<T>(collection, payload);
  }

  const recommendPackageWithTenantEvidence: DigitalEmployeeApplicationPorts['recommendPackageWithTenantEvidence'] = (...args) => deps.recommendPackageWithTenantEvidence(...args);

  const appendAudit: DigitalEmployeeApplicationPorts['appendAudit'] = (...args) => deps.appendAudit(...args);

  const buildOverview: DigitalEmployeeApplicationPorts['buildOverview'] = (...args) => deps.buildOverview(...args);

  const approveGoalForReview: DigitalEmployeeApplicationPorts['approveGoalForReview'] = (...args) => deps.approveGoalForReview(...args);

  function registerPostGoals() {
    digitalEmployeesRouter.post('/goals/:goalId/rebind-image-references', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      const overview = await buildOverview(tenantId, req.params.goalId);
      if (overview.goal?.id !== req.params.goalId || !overview.plan?.businessPackage || !overview.plan.id) {
        res.status(404).json({ error: 'weekly_goal_not_found' }); return;
      }
      const current = await store.getById<PlanRecord>(COLLECTION.plans, overview.plan.id);
      if (!current || current.tenant_id !== tenantId || current.goal_id !== req.params.goalId || current.status !== 'draft') {
        res.status(409).json({ error: 'weekly_plan_not_draft' }); return;
      }
      const body = jsonObject<Record<string, unknown>>(current.plan, {});
      const pack = body.businessPackage as WeeklyPackage | undefined;
      if (!pack?.mixedContentSlots) { res.status(409).json({ error: 'weekly_image_slots_missing' }); return; }
      const library = await store.list<StoredRecord>('trend_videos', { where: { tenantId }, sort: '-updatedAt', perPage: 500 });
      const rebound = bindWeeklyImageReferences(pack, library.items);
      const gate = weeklyReferenceCreationGate(rebound, library.items);
      if (!gate.ready) { res.status(409).json({ error: 'weekly_reference_shortage', ...gate }); return; }
      const reboundSlots = rebound.mixedContentSlots || [];
      if (JSON.stringify(rebound.mixedContentSlots) !== JSON.stringify(pack.mixedContentSlots)) {
        if (!store.compareAndSwap || await store.supportsAtomicCompareAndSwapFor?.(COLLECTION.plans) !== true) {
          res.status(503).json({ error: 'weekly_plan_atomic_store_required' }); return;
        }
        const updated = await store.compareAndSwap(COLLECTION.plans, current.id,
          { status: 'draft', plan: current.plan }, { plan: { ...body, businessPackage: { ...rebound, revision: rebound.revision + 1 } } });
        if (!updated) { res.status(409).json({ error: 'weekly_plan_changed' }); return; }
        await appendAudit({ tenantId, userId, action: 'weekly_image_references.bound', targetType: 'weekly_plan', targetId: current.id,
          metadata: { goalId: req.params.goalId, imageCount: reboundSlots.filter(slot => slot.kind === 'image' && slot.productionRole === 'original').length } });
      }
      res.json(await buildOverview(tenantId, req.params.goalId));
    });
    digitalEmployeesRouter.get('/goals/:goalId/reference-readiness', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const overview = await buildOverview(tenantId, req.params.goalId);
      if (overview.goal?.id !== req.params.goalId || !overview.plan?.businessPackage) {
        res.status(404).json({ error: 'weekly_goal_not_found' });
        return;
      }
      const library = await store.list<StoredRecord>('trend_videos', { where: { tenantId }, perPage: 500 });
      res.json(weeklyReferenceCreationGate(overview.plan.businessPackage, library.items));
    });
    digitalEmployeesRouter.post('/goals', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      const configRecord = await configForTenant(tenantId);
      const resolvedConfiguration = await resolveCurrentConfiguration(tenantId, configRecord);
      const config = resolvedConfiguration?.config || null;
      if (!config || !resolvedConfiguration) { res.status(409).json({ error: 'onboarding_required' }); return; }
      const enterpriseProfile = enterpriseProfileFromKnowledgeBinding(resolvedConfiguration.knowledgeBinding) as EnterpriseProfile | null;
      if (!enterpriseProfile) { res.status(409).json({ error: 'enterprise_fact_snapshot_missing' }); return; }
      if (config.smartOperationsEnabled === false) {
        res.status(409).json({ error: 'smart_operations_disabled', message: '智能经营已关闭；历史任务仍可查看，开启后才能制定新的周目标。' });
        return;
      }
      const requestedPlatforms = Array.isArray(req.body?.contentPlatforms) ? req.body.contentPlatforms : [];
      const requestedVideoPlans = Array.isArray(req.body?.videoPlans) ? req.body.videoPlans : [];
      if (requestedPlatforms.some((platform: unknown) => !isContentProductionPlatform(platform))
        || requestedVideoPlans.some((plan: { platform?: unknown }) => !isContentProductionPlatform(plan?.platform))) {
        res.status(400).json({ error: 'content_production_platform_unsupported', message: '内容制作仅支持 LinkedIn 和 Facebook；资讯和爆款采集仍支持全平台。' });
        return;
      }
      const goal = normalizeWeeklyGoal(req.body || {}, config);
      const missing = validateWeeklyGoal(goal);
      if (missing.length) { res.status(400).json({ error: 'goal_invalid', missing }); return; }
      const planDraft = buildWeeklyPlan(goal, config);
      const recommendedPackage = await recommendPackageWithTenantEvidence(tenantId, goal, config, userId, '', enterpriseProfile);
      const missingProducts = weeklyImageProductShortage(recommendedPackage);
      if (missingProducts) {
        res.status(409).json({ error: 'weekly_focus_products_missing',
          message: `本周单图计划需要 3 个主推产品，还缺 ${missingProducts} 个。请先在企业资料中补齐主推产品。`, missingProducts });
        return;
      }
      const referenceLibrary = await store.list<StoredRecord>('trend_videos', { where: { tenantId }, perPage: 500 });
      const referenceGate = weeklyReferenceCreationGate(recommendedPackage, referenceLibrary.items);
      if (!referenceGate.ready) {
        res.status(409).json({
          error: 'weekly_reference_shortage',
          message: `本周还缺 ${referenceGate.videoMissingCount} 条爆款视频、${referenceGate.imageMissingCount} 条爆款图文参考。请手动录入或立即采集并完成分析后再确认周任务。`,
          ...referenceGate,
        });
        return;
      }
      const now = new Date().toISOString();
      const created = await requiredCreate<GoalRecord>(COLLECTION.goals, {
        tenant_id: tenantId,
        business_line: goal.businessLine,
        content_platforms: goal.contentPlatforms,
        title: goal.title,
        objective: goal.objective,
        metric: goal.metric,
        baseline: goal.baseline,
        target: goal.target,
        unit: goal.unit,
        starts_at: goal.startsAt,
        ends_at: goal.endsAt,
        scope: goal.videoPlans ? { description: goal.scope, videoPlans: goal.videoPlans, promotionPlans: goal.promotionPlans || [] } : goal.scope,
        constraints: goal.constraints,
        owner_id: userId,
        status: 'draft',
        version: 1,
        created_at: now,
        updated_at: now,
      });
      const plan = await requiredCreate<PlanRecord>(COLLECTION.plans, {
        tenant_id: tenantId,
        goal_id: created.id,
        status: 'draft',
        plan: { ...planDraft, ...configurationSnapshot(resolvedConfiguration), businessPackage: recommendedPackage },
        created_at: now,
      });
      await appendAudit({ tenantId, userId, action: 'weekly_goal.created', targetType: 'weekly_goal', targetId: created.id, metadata: { metric: goal.metric, target: goal.target, draftPlanId: plan.id } });
      res.status(201).json(await buildOverview(tenantId, created.id));
    });
  }

  function registerPostGoalsGoalIdApprove() {
    digitalEmployeesRouter.post('/goals/:goalId/approve', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      const authorization = contentGenerationAuthorization(req.body?.contentGenerationAuthorization);
      if (!authorization) {
        res.status(400).json({
          error: 'content_generation_authorization_required',
          message: '开始任务前，请先确认授权数字员工调用已配置的内容生成模型。',
        });
        return;
      }
      const members = await listTenantEmployees(res.locals as AuthLocals, req.headers.authorization);
      const result = await approveGoalForReview(tenantId, userId, req.params.goalId, req.body?.packageRevision, members, authorization,
        typeof req.body?.finishedFilmOverBudgetQuoteKey === 'string' && req.body.finishedFilmOverBudgetQuoteKey.length <= 4_000
          ? req.body.finishedFilmOverBudgetQuoteKey : '');
      res.status(result.status).json(result.body);
    });
  }

  return { registerPostGoals, registerPostGoalsGoalIdApprove };
}
