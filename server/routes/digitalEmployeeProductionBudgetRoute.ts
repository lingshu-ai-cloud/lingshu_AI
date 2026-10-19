import type { Router } from 'express';
import type { AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, jsonObject, type ConfigRecord, type ContentBatchPlanRecord, type GoalRecord, type PlanRecord, type RunRecord, type StoredRecord, type TaskRecord } from './digitalEmployeeRecords.js';
import type { DigitalEmployeeConfig, WeeklyGoalInput } from '../digitalEmployees/domain.js';
import type { EnterpriseProfile } from './enterprise.js';
import { withDigitalEmployeeRunLock } from '../digitalEmployees/runControl.js';
import { managedReplicationPlanHasExecutionGraph } from '../digitalEmployees/replicationContentProduction.js';
import { generateDirectorScriptContracts, refreshExpandedContentOrderContract, storyboardVoiceLanguageMatches } from '../digitalEmployees/contentProduction.js';
import { repairCollapsedWeeklyVideoProduction, packageConfig } from '../digitalEmployees/weeklyPackage.js';
import { verifiedStoryboardProviderCostRange } from '../digitalEmployees/contentPlanRecommendation.js';
import { normalizeVideoPlan, type VideoCreationPlan } from '../../shared/contracts/videoCreationPlan.js';
import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import type { ContentOrder } from '../digitalEmployees/contentBatchPlan.js';

interface ProductionBudgetRouteDependencies {
  tenantRecord<T extends StoredRecord & { tenant_id: string }>(collection: string, id: string, tenantId: string): Promise<T | null>;
  publicConfig(record: ConfigRecord | null): DigitalEmployeeConfig | null;
  configForTenant(tenantId: string): Promise<ConfigRecord | null>;
  executionConfigForPlan(plan: PlanRecord | null, fallback: DigitalEmployeeConfig): DigitalEmployeeConfig;
  ensureFrozenEnterpriseProfileForRun(tenantId: string, plan: PlanRecord | null, config: DigitalEmployeeConfig, boundAt: string): Promise<EnterpriseProfile>;
  goalInput(goal: GoalRecord): WeeklyGoalInput;
  appendEvent(input: Record<string, unknown>): Promise<unknown>;
  appendAudit(input: Record<string, unknown>): Promise<unknown>;
  buildOverview(tenantId: string, goalId?: string): Promise<unknown>;
}

export function registerProductionBudgetReforecastRoute(router: Router, deps: ProductionBudgetRouteDependencies): void {
  const { tenantRecord, publicConfig, configForTenant, executionConfigForPlan, ensureFrozenEnterpriseProfileForRun, goalInput, appendEvent, appendAudit, buildOverview } = deps;
router.post('/tasks/:taskId/production-budget-reforecast', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const mode = req.body?.mode === 'economy' ? 'economy' as const
    : req.body?.mode === 'protected' ? 'protected' as const : null;
  if (!mode) {
    res.status(400).json({ error: 'production_budget_mode_invalid', message: '请选择有效的开工预算方案。' });
    return;
  }
  const initialTask = await tenantRecord<TaskRecord>(COLLECTION.tasks, req.params.taskId, tenantId);
  if (!initialTask) { res.status(404).json({ error: 'task_not_found' }); return; }
  if (initialTask.task_key !== 'content_production') {
    res.status(409).json({ error: 'production_budget_task_invalid', message: '只有内容生产任务可以重算制作预算。' });
    return;
  }
  try {
    await withDigitalEmployeeRunLock(tenantId, initialTask.run_id, async () => {
      const task = await tenantRecord<TaskRecord>(COLLECTION.tasks, initialTask.id, tenantId);
      const run = await tenantRecord<RunRecord>(COLLECTION.runs, initialTask.run_id, tenantId);
      const plan = run ? await tenantRecord<PlanRecord>(COLLECTION.plans, run.plan_id, tenantId) : null;
      const goal = task ? await tenantRecord<GoalRecord>(COLLECTION.goals, task.goal_id, tenantId) : null;
      const currentConfig = publicConfig(await configForTenant(tenantId));
      if (!task || !run || !plan || !goal || !currentConfig || task.run_id !== run.id || task.plan_id !== plan.id) throw new Error('production_budget_context_missing');
      if (!['waiting_external', 'waiting_human', 'failed', 'running'].includes(run.status)
        || !['waiting_external', 'waiting_human', 'failed', 'running'].includes(task.status)) {
        throw new Error('production_budget_reforecast_not_allowed');
      }
      const projects = await store.list<StoredRecord>('studio_projects', { where: { tenant_id: tenantId }, perPage: 500 });
      const managedProjects = projects.items.filter(project => {
        const spec = jsonObject<Record<string, unknown>>(project.spec, {});
        return String(spec.workflowRunId || '') === run.id && String(spec.workflowTaskId || '') === task.id;
      });
      const hasFrozenSpeechEvidence = (spec: Record<string, unknown>) => {
        const shots = Array.isArray(spec.automatedReplicationShots)
          ? spec.automatedReplicationShots as Array<Record<string, unknown>> : [];
        const personShotIds = new Set(shots.filter(shot => shot.kind === 'person').map(shot => String(shot.shotId || '')));
        if (!personShotIds.size) return false;
        const progress = jsonObject<Record<string, Record<string, unknown>>>(spec.automatedReplicationProgress, {});
        const productions = jsonObject<Record<string, Record<string, unknown>>>(spec.shotProductions, {});
        return [...personShotIds].some(shotId => {
          const state = progress[shotId] || {};
          const production = Object.entries(productions).find(([key]) => key.endsWith(`:${shotId}`))?.[1] || {};
          return Boolean(state.videoMaterialId || state.providerTaskId || state.adopted
            || jsonObject<Record<string, unknown>>(production.digitalHuman, {}).providerTaskId);
        });
      };
      const legacyRepairProjects = managedProjects.filter(project => {
        const spec = jsonObject<Record<string, unknown>>(project.spec, {});
        const automation = jsonObject<Record<string, unknown>>(spec.automation, {});
        const order = jsonObject<ContentOrder | undefined>(spec.contentOrder, undefined);
        const language = String(spec.lang || order?.videoPlan?.language || order?.languages?.[0] || 'en');
        const frozenScript = order?.scripts?.[language]?.body || '';
        const versionOnlyPlan = Number(jsonObject<Record<string, unknown>>(spec.automatedReplicationPlan, {}).version || 0) >= 2
          && !managedReplicationPlanHasExecutionGraph(spec);
        const invalidLanguageContract = Boolean(frozenScript && !storyboardVoiceLanguageMatches(frozenScript, language));
        const contractMismatch = Boolean(frozenScript
          && (String(spec.script || '') !== frozenScript || invalidLanguageContract)
          && !hasFrozenSpeechEvidence(spec));
        return (String(automation.stage || '') === 'blocked'
          && /预算计划|budget plan/i.test(String(automation.blocker || '')))
          || versionOnlyPlan || contractMismatch;
      });
      if (!legacyRepairProjects.length) throw new Error('production_budget_reforecast_not_required');

      const planBody = jsonObject<Record<string, unknown>>(plan.plan, {});
      const pack = planBody.businessPackage
        ? repairCollapsedWeeklyVideoProduction(planBody.businessPackage as WeeklyPackage)
        : undefined;
      if (!pack?.directorPlan) throw new Error('production_budget_plan_missing');
      const productionTask = pack.tasks.find(item => item.templateId === 'production');
      const sourcePlans = productionTask?.videoPlans || [];
      const nextPlans = sourcePlans.map(source => {
        const item = normalizeVideoPlan(source);
        if (item.productionRole === 'platform_adaptation' || item.route !== 'clone') return item;
        const range = verifiedStoryboardProviderCostRange(item.benchmarkAnalysis);
        if (!range) throw new Error(`production_budget_storyboard_unverified:${item.contentId || 'unknown'}`);
        return normalizeVideoPlan({ ...item, estimatedCost: range.minCny, estimatedCostRange: range });
      });
      const masters = nextPlans.filter(item => item.productionRole !== 'platform_adaptation');
      if (!masters.length || masters.some(item => item.route === 'clone'
        && item.estimatedCostRange?.basis !== 'verified_storyboard_provider_envelope')) {
        throw new Error('production_budget_storyboard_unverified');
      }
      const productionBudgetMin = Math.round(masters.reduce((sum, item) => sum + Number(item.estimatedCostRange?.minCny || item.estimatedCost || 0), 0) * 100) / 100;
      const productionBudgetMax = Math.round(masters.reduce((sum, item) => sum + Number(item.estimatedCostRange?.maxCny || item.estimatedCost || 0), 0) * 100) / 100;
      const approvedCeilingCny = mode === 'economy' ? productionBudgetMin : productionBudgetMax;
      const selectedContentCap = (item: VideoCreationPlan) => Number(mode === 'economy'
        ? item.estimatedCostRange?.minCny || item.estimatedCost || 0
        : item.estimatedCostRange?.maxCny || item.estimatedCost || 0);
      const explicitBatchCeiling = process.env.STORYBOARD_AIGC_BATCH_BUDGET_CNY === undefined
        ? null : Number(process.env.STORYBOARD_AIGC_BATCH_BUDGET_CNY);
      if (explicitBatchCeiling !== null && (!Number.isFinite(explicitBatchCeiling) || explicitBatchCeiling <= 0
        || masters.some(item => selectedContentCap(item) > explicitBatchCeiling + 0.000001))) {
        throw new Error('production_budget_environment_ceiling_too_low');
      }
      if (productionBudgetMin <= 0 || productionBudgetMax < productionBudgetMin) throw new Error('production_budget_forecast_invalid');
      const now = new Date().toISOString();
      const nextByContentId = new Map(nextPlans.map(item => [item.contentId, item]));
      const frozenOperatingContext = (
        videoPlan: VideoCreationPlan,
        existing: ContentOrder['operatingContext'],
      ): NonNullable<ContentOrder['operatingContext']> => ({
        ...(existing || {}),
        productionBudget: approvedCeilingCny,
        productionBudgetMax: approvedCeilingCny,
        productionSpent: Number(existing?.productionSpent || pack.directorPlan?.productionSpent || 0),
        productionReserved: approvedCeilingCny,
        estimatedContentCost: Number(videoPlan.estimatedCostRange?.minCny || videoPlan.estimatedCost || 0),
        estimatedContentCostMax: selectedContentCap(videoPlan),
        productionBudgetMode: mode,
        maxAigcRetries: mode === 'economy' ? 0 : 1,
        budgetApprovedAt: now,
        originalTarget: Number(existing?.originalTarget || pack.directorPlan?.originalTarget || masters.length),
        platformVersionTarget: Number(existing?.platformVersionTarget || pack.directorPlan?.platformVersionTarget || nextPlans.length),
        publishTarget: Number(existing?.publishTarget || pack.directorPlan?.publishTarget || nextPlans.length),
        qualityStandard: String(existing?.qualityStandard || pack.directorPlan?.qualityStandard || ''),
        packageRevision: Number(existing?.packageRevision || pack.revision || 0),
      });
      const nextPack: WeeklyPackage = {
        ...pack,
        directorPlan: {
          ...pack.directorPlan,
          productionBudgetMode: mode,
          productionBudget: approvedCeilingCny,
          productionBudgetMin,
          productionBudgetMax,
          productionReserved: approvedCeilingCny,
        },
        tasks: pack.tasks.map(item => item.templateId === 'production' ? { ...item, videoPlans: nextPlans } : item),
      };
      const executionConfig = executionConfigForPlan(plan, currentConfig);
      const enterpriseProfile = await ensureFrozenEnterpriseProfileForRun(tenantId, plan, executionConfig, run.started_at);
      const batches = await store.list<ContentBatchPlanRecord>(COLLECTION.contentBatchPlans, { where: { tenant_id: tenantId, run_id: run.id }, perPage: 20 });
      const repairedOrdersById = new Map<string, ContentOrder>();
      const repairedOrdersByContentId = new Map<string, ContentOrder>();
      const preparedBatches: Array<{ batch: ContentBatchPlanRecord; orders: ContentOrder[] }> = [];
      for (const batch of batches.items) {
        const orders = jsonObject<ContentOrder[]>(batch.orders, []);
        const budgetedOrders = orders.map(order => {
          const videoPlan = nextByContentId.get(order.videoPlan?.contentId || '');
          if (!videoPlan) return order;
          return {
            ...order,
            videoPlan,
            operatingContext: frozenOperatingContext(videoPlan, order.operatingContext),
          } satisfies ContentOrder;
        });
        const scriptableOrders = budgetedOrders.filter(order => !order.readinessBlockers?.length);
        const directedOrders = scriptableOrders.length ? await generateDirectorScriptContracts({
          tenantId,
          config: executionConfig,
          goal: goalInput(goal),
          orders: scriptableOrders,
          now,
          enterpriseProfile,
        }) : [];
        const directedById = new Map(directedOrders.map(order => [order.id, order]));
        const nextOrders = budgetedOrders.map(order => {
          const directed = directedById.get(order.id);
          const nextOrder = directed ? {
            ...order,
            contractVersion: directed.contractVersion,
            scripts: directed.scripts,
          } satisfies ContentOrder : order;
          repairedOrdersById.set(nextOrder.id, nextOrder);
          if (nextOrder.videoPlan?.contentId) repairedOrdersByContentId.set(nextOrder.videoPlan.contentId, nextOrder);
          return nextOrder;
        });
        preparedBatches.push({ batch, orders: nextOrders });
      }
      if (!await store.update(COLLECTION.plans, plan.id, { plan: { ...planBody, businessPackage: nextPack }, updated_at: now })) {
        throw new Error('production_budget_plan_update_failed');
      }
      for (const prepared of preparedBatches) {
        if (!await store.update(COLLECTION.contentBatchPlans, prepared.batch.id, { orders: prepared.orders, updated_at: now })) {
          throw new Error('production_budget_batch_update_failed');
        }
      }
      const repairedScriptProjectIds: string[] = [];
      for (const project of managedProjects) {
        const spec = jsonObject<Record<string, unknown>>(project.spec, {});
        const order = jsonObject<ContentOrder | undefined>(spec.contentOrder, undefined);
        const sourceOrderId = String((order as (ContentOrder & { sourceContentOrderId?: string }) | undefined)?.sourceContentOrderId
          || order?.id.split('::')[0] || '');
        const repairedBaseOrder = order ? repairedOrdersById.get(sourceOrderId)
          || repairedOrdersByContentId.get(order.videoPlan?.contentId || '') : undefined;
        if (!order || !repairedBaseOrder) continue;
        const language = String(spec.lang || order.videoPlan?.language || repairedBaseOrder.videoPlan?.language || repairedBaseOrder.languages?.[0] || 'en');
        // Projects are language-expanded copies (`base-order::en`). Preserve
        // their stable identity and lineage while refreshing the repaired base
        // order contract that was frozen in the batch plan.
        const nextOrder = refreshExpandedContentOrderContract(order, repairedBaseOrder, language);
        const previousScriptHash = order.scripts?.[language]?.hash || '';
        const nextScriptHash = nextOrder.scripts?.[language]?.hash || '';
        const nextScriptBody = nextOrder.scripts?.[language]?.body || '';
        const scriptRepaired = Boolean(!hasFrozenSpeechEvidence(spec) && nextScriptHash
          && (previousScriptHash !== nextScriptHash || String(spec.script || '') !== nextScriptBody));
        const automation = jsonObject<Record<string, unknown>>(spec.automation, {});
        const { retryPolicy: _retryPolicy, retryAfter: _retryAfter, resumeStage: _resumeStage, ...preservedAutomation } = automation;
        const nextSpec = {
          ...spec,
          contentOrder: nextOrder,
          ...(scriptRepaired ? {
            script: nextScriptBody,
            automation: {
              ...preservedAutomation,
              stage: 'script',
              status: 'queued',
              blocker: '',
              scriptRepairReason: 'legacy_language_contract_mismatch',
              scriptRepairedAt: now,
              updatedAt: now,
            },
          } : {}),
        };
        if (!await store.update('studio_projects', project.id, { spec: nextSpec, updated_at: now })) {
          throw new Error('production_budget_project_update_failed');
        }
        if (scriptRepaired) repairedScriptProjectIds.push(project.id);
      }
      await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'content.production_budget_reforecasted', level: 'info',
        summary: mode === 'economy' ? '已按精简方案重新核定制作预算' : '已按完整保障方案重新核定制作预算',
        payload: { mode, productionBudgetMin, productionBudgetMax, approvedCeilingCny, projectIds: managedProjects.map(item => item.id), repairedScriptProjectIds, externalPublishPerformed: false } });
      await appendAudit({ tenantId, userId, action: 'content_production.budget_reforecasted', targetType: 'workflow_task', targetId: task.id,
        metadata: { runId: run.id, mode, productionBudgetMin, productionBudgetMax, approvedCeilingCny, projectIds: managedProjects.map(item => item.id), repairedScriptProjectIds } });
    });
    res.json(await buildOverview(tenantId, initialTask.goal_id));
  } catch (error) {
    const code = error instanceof Error ? error.message : 'production_budget_reforecast_failed';
    const [errorCode, subject] = code.split(':', 2);
    const messageByCode: Record<string, string> = {
      production_budget_context_missing: '当前生产任务的预算上下文不完整，请刷新后重试。',
      production_budget_reforecast_not_allowed: '当前任务状态不允许重算制作预算。',
      production_budget_reforecast_not_required: '当前任务没有旧预算卡点，无需重算。',
      production_budget_plan_missing: '周计划缺少制作预算信息。',
      production_budget_storyboard_unverified: `内容 ${subject || ''} 的分镜尚未完成可靠预算核算。`.trim(),
      production_budget_environment_ceiling_too_low: '系统配置的单条制作上限低于已核定预算，请先调整服务端上限。',
      production_budget_forecast_invalid: '制作预算结果无效，未修改当前任务。',
    };
    res.status(errorCode === 'production_budget_reforecast_not_required' ? 409 : 422).json({ error: errorCode, message: messageByCode[errorCode] || '制作预算重算失败，未修改当前任务。' });
  }
});

}
