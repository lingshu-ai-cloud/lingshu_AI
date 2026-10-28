import { listTenantEmployees } from './auth.js';

import { type AuthLocals } from '../middleware/auth.js';
import { type EnterpriseProfile } from './enterprise.js';
import { configurationSnapshot, enterpriseProfileFromKnowledgeBinding } from '../digitalEmployees/configuration.js';

import { buildWeeklyPlan, normalizeWeeklyGoal, validateWeeklyGoal } from '../digitalEmployees/domain.js';
import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, type GoalRecord, type PlanRecord, type StoredRecord } from '../digitalEmployees/records.js';
import type { DigitalEmployeeApplicationPorts } from '../digitalEmployees/applicationPorts.js';
import { contentGenerationAuthorization } from '../../shared/contracts/contentGenerationAuthorization.js';
import { isContentProductionPlatform } from '../../shared/contracts/contentProductionPlatforms.js';
import { store } from '../storage/index.js';
import { weeklyReferenceCreationGate } from '../digitalEmployees/weeklyReferenceCreationGate.js';

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
      const referenceLibrary = await store.list<StoredRecord>('trend_videos', { where: { tenantId }, perPage: 500 });
      const referenceGate = weeklyReferenceCreationGate(recommendedPackage, referenceLibrary.items);
      if (!referenceGate.ready) {
        res.status(409).json({
          error: 'weekly_reference_shortage',
          message: `本周还缺 ${referenceGate.missingCount} 条可用于制作的爆款视频。请手动录入并完成逐镜分析，或立即采集后再确认周任务。`,
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
          message: '开始任务前，请先确认授权数字员工调用已配置的内容生成模型；实际用量和费用只记录，不设创作预算上限。',
        });
        return;
      }
      const members = await listTenantEmployees(res.locals as AuthLocals, req.headers.authorization);
      const result = await approveGoalForReview(tenantId, userId, req.params.goalId, req.body?.packageRevision, members, authorization);
      res.status(result.status).json(result.body);
    });
  }

  return { registerPostGoals, registerPostGoalsGoalIdApprove };
}
