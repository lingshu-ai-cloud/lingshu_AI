import { beijingDate } from '../digitalEmployees/runtimeSchedule.js';
import { hasWeeklyGoalFactRebuildPlanFence } from '../digitalEmployees/goalFactRebuild.js';
import { acquireDurableOperationLease, assertDurableOperationLease, releaseDurableOperationLease } from '../runtime/durableLease.js';
import { randomUUID } from 'node:crypto';
import { listTenantEmployees } from './auth.js';
import { normalizePackage, repairCollapsedWeeklyVideoProduction, compilePackage } from '../digitalEmployees/weeklyPackage.js';
import { TASK_TEMPLATES, type WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import { normalizeVideoPlan, type VideoCreationPlan } from '../../shared/contracts/videoCreationPlan.js';
import { type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { readTenantEnterpriseProfile, type EnterpriseProfile } from './enterprise.js';
import { readServerProductionOnboardingReadiness } from '../digitalEmployees/productionOnboardingPreflight.js';
import { weeklyMaterialGaps } from '../digitalEmployees/weeklyMaterialGaps.js';
import { enterpriseAssetStableId, type ContentOrder } from '../digitalEmployees/contentBatchPlan.js';
import { publicationCopyForPlan } from '../digitalEmployees/contentPlanRecommendation.js';
import { configurationSnapshot, enterpriseProfileFromKnowledgeBinding } from '../digitalEmployees/configuration.js';
import { localPublishingAccountMocksEnabled } from '../digitalEmployees/publishingTargets.js';
import { contentRoutingEvidence } from './digitalEmployeeContentEvidence.js';
import { configSnapshotForPlan, goalInput, publicConfig } from '../digitalEmployees/overviewProjection.js';
import { exactVideoAnalysis, studioProjectRendered } from '../digitalEmployees/taskEvidenceProjection.js';

import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, jsonObject, withLocalQueue, type GoalRecord, type PlanRecord, type RunRecord, type StoredRecord, type ContentBatchPlanRecord, type TaskRecord } from '../digitalEmployees/records.js';
import type { DigitalEmployeeApplicationPorts } from '../digitalEmployees/applicationPorts.js';

export function createDigitalEmployeePackageRoutes(deps: Pick<DigitalEmployeeApplicationPorts, 'digitalEmployeesRouter' | 'configForTenant' | 'resolveCurrentConfiguration' | 'getWhatsAppCustomers' | 'tenantRecord' | 'weeklyGoalFactRebuildTargetCommitted' | 'first' | 'weeklyGoalFactRebuildRecovery' | 'frozenEnterpriseProfileForPlan' | 'recommendPackageWithTenantEvidence' | 'goalApprovalQueues' | 'buildOverview' | 'generateWeeklyTaskPreviews' | 'appendAudit' | 'executionConfigForPlan'>) {
  const digitalEmployeesRouter = deps.digitalEmployeesRouter;
  const executionConfigForPlan: DigitalEmployeeApplicationPorts['executionConfigForPlan'] = (...args) => deps.executionConfigForPlan(...args);

  const configForTenant: DigitalEmployeeApplicationPorts['configForTenant'] = (...args) => deps.configForTenant(...args);

  const resolveCurrentConfiguration: DigitalEmployeeApplicationPorts['resolveCurrentConfiguration'] = (...args) => deps.resolveCurrentConfiguration(...args);

  const getWhatsAppCustomers: DigitalEmployeeApplicationPorts['getWhatsAppCustomers'] = (...args) => deps.getWhatsAppCustomers(...args);

  function tenantRecord<T extends StoredRecord & { tenant_id: string }>(collection: string, id: string, tenantId: string): Promise<T | null> {
    return deps.tenantRecord<T>(collection, id, tenantId);
  }

  const weeklyGoalFactRebuildTargetCommitted: DigitalEmployeeApplicationPorts['weeklyGoalFactRebuildTargetCommitted'] = (...args) => deps.weeklyGoalFactRebuildTargetCommitted(...args);

  function first<T extends StoredRecord>(collection: string, where: Record<string, string | number | boolean>, sort = '-created_at'): Promise<T | null> {
    return deps.first<T>(collection, where, sort);
  }

  const weeklyGoalFactRebuildRecovery: DigitalEmployeeApplicationPorts['weeklyGoalFactRebuildRecovery'] = (...args) => deps.weeklyGoalFactRebuildRecovery(...args);

  const frozenEnterpriseProfileForPlan: DigitalEmployeeApplicationPorts['frozenEnterpriseProfileForPlan'] = (...args) => deps.frozenEnterpriseProfileForPlan(...args);

  const recommendPackageWithTenantEvidence: DigitalEmployeeApplicationPorts['recommendPackageWithTenantEvidence'] = (...args) => deps.recommendPackageWithTenantEvidence(...args);

  const goalApprovalQueues = deps.goalApprovalQueues;

  const buildOverview: DigitalEmployeeApplicationPorts['buildOverview'] = (...args) => deps.buildOverview(...args);

  const generateWeeklyTaskPreviews: DigitalEmployeeApplicationPorts['generateWeeklyTaskPreviews'] = (...args) => deps.generateWeeklyTaskPreviews(...args);

  const appendAudit: DigitalEmployeeApplicationPorts['appendAudit'] = (...args) => deps.appendAudit(...args);

  function registerGetGoalsGoalIdProductionReadiness() {
    digitalEmployeesRouter.get('/goals/:goalId/production-readiness', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      try {
        const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, req.params.goalId, tenantId);
        if (!goal) { res.status(404).json({ error: 'goal_not_found' }); return; }
        const plan = await first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: goal.id });
        if (!plan) { res.status(404).json({ error: 'plan_not_found' }); return; }
        const body = jsonObject<Record<string, unknown>>(plan.plan, {});
        const pack = body.businessPackage as WeeklyPackage | undefined;
        if (!pack) { res.status(409).json({ error: 'weekly_package_missing' }); return; }
        const configRecord = await configForTenant(tenantId);
        const config = publicConfig(configRecord);
        if (!config) { res.status(409).json({ error: 'onboarding_required' }); return; }
        const resolved = await resolveCurrentConfiguration(tenantId, configRecord);
        const savedFactsVersion = String(jsonObject<Record<string, unknown>>(body.knowledgeBinding, {}).factsVersion || '').trim();
        const currentFactsVersion = resolved?.knowledgeBinding.factsVersion || '';
        if (plan.status === 'draft' && savedFactsVersion && currentFactsVersion && savedFactsVersion !== currentFactsVersion) {
          res.json({ ready: false, blockers: [{ code: 'enterprise_facts_mismatch', message: '企业资料已更新，当前周计划需要同步', action: 'rebuild_weekly_goal' }],
            recovery: weeklyGoalFactRebuildRecovery(goal, plan, savedFactsVersion, currentFactsVersion) });
          return;
        }
        const profile = frozenEnterpriseProfileForPlan(plan, false)
          || (resolved ? enterpriseProfileFromKnowledgeBinding(resolved.knowledgeBinding) as EnterpriseProfile | null : null);
        if (!profile) {
          res.json({ ready: false, blockers: [{ code: 'enterprise_facts_mismatch', message: '企业与产品资料需要重新确认', action: 'complete_enterprise_profile' }] });
          return;
        }
        const plans = (pack.tasks.find(task => task.templateId === 'production')?.videoPlans || [])
          .filter(item => item.productionRole !== 'platform_adaptation');
        const readiness = await readServerProductionOnboardingReadiness({
          store, tenantId, profile, preferences: configSnapshotForPlan(plan, config).productionOnboarding,
          plans, budgetConfirmed: true,
        });
        res.json({ ready: readiness.ready, blockers: readiness.blockers.map(({ code, message, action }) => ({ code, message, action })),
          materialGaps: weeklyMaterialGaps(plans, readiness.materialRequirementGaps || []) });
      } catch {
        res.status(503).json({ error: 'production_onboarding_preflight_unavailable', message: '制作资料暂时无法核验' });
      }
    });
  }

  function registerGetPlanningOptions() {
    digitalEmployeesRouter.get('/planning-options', async (_req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const config = await configForTenant(tenantId);
      const resolved = await resolveCurrentConfiguration(tenantId, config);
      if (!resolved) { res.status(409).json({ error: 'onboarding_required' }); return; }
      const evidence = await contentRoutingEvidence(tenantId, resolved.config);
      const profile = await readTenantEnterpriseProfile(tenantId);
      const assets = (profile.products?.items || []).flatMap((product: any, index) => {
        const groups = ['images', 'videos', 'factoryImages', 'packagingImages', 'sceneImages', 'brandAssets'].map(key => Array.isArray(product[key]) ? product[key] : []);
        if (String(product.imageUrl || '').trim()) groups.unshift([{ url: product.imageUrl, name: '产品封面' }]);
        return groups.flat().map((asset: any, assetIndex: number) => ({ id: enterpriseAssetStableId(index, assetIndex, String(asset.url || '')), name: asset.name || '产品素材' }));
      });
      const videos = await store.list<StoredRecord>('trend_videos', { where: { tenantId }, perPage: 500 });
      res.json({ ...evidence, assets, references: videos.items.filter(exactVideoAnalysis).map(item => {
          const analysis = jsonObject<Record<string, any>>(item.aiAnalysis, {});
          const thumbnailUrl = [item.thumbnailUrl, item.coverUrl, item.thumbnail, analysis.thumbnailUrl, analysis.coverUrl]
            .map(value => String(value || '').trim()).find(Boolean) || '';
          const sourceUrl = [item.sourceUrl, item.videoUrl, item.url, analysis.sourceUrl, analysis.videoUrl]
            .map(value => String(value || '').trim()).find(Boolean) || '';
          return {
            id: item.id,
            name: String(item.title || item.id),
            platform: String(item.platform || ''),
            thumbnailUrl,
            sourceUrl,
            views: String(item.views || analysis.views || ''),
            account: String(analysis.sourceAccountName || analysis.author || item.author || ''),
          };
        }) });
    });
  }

  function registerGetPackageOptions() {
    digitalEmployeesRouter.get('/package-options', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const [members, projects] = await Promise.all([listTenantEmployees(res.locals as AuthLocals, req.headers.authorization), store.list<StoredRecord>('studio_projects', { where: { tenant_id: tenantId }, perPage: 500 })]);
      res.json({ members: members.map(m => ({ id: m.id, name: m.name || m.email })), projects: projects.items.filter(studioProjectRendered).map(p => ({ id: p.id, title: String(p.title || p.id) })), customers: (await getWhatsAppCustomers(tenantId)).map(c => ({ id: c.id, name: String(c.name || c.id) })) });
    });
  }

  function registerPostGoalsGoalIdPackageRecommend() {
    digitalEmployeesRouter.post('/goals/:goalId/package/recommend', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, req.params.goalId, tenantId);
      if (!goal || goal.status !== 'draft') { res.status(409).json({ error: 'draft_required' }); return; }
      if (!await weeklyGoalFactRebuildTargetCommitted(tenantId, goal)) {
        res.status(409).json({ error: 'goal_fact_rebuild_not_committed', message: '最新事实周目标尚未完成安全替换，暂不能修改。' }); return;
      }
      const plan = await first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: goal.id });
      const configRecord = await configForTenant(tenantId);
      const current = publicConfig(configRecord);
      if (!current) { res.status(409).json({ error: 'onboarding_required' }); return; }
      const resolved = await resolveCurrentConfiguration(tenantId, configRecord);
      const snapshot = configSnapshotForPlan(plan, current);
      // Local development intentionally provides one enterprise-named account per
      // supported platform. Recommending a draft must rebind legacy `planned:*`
      // targets to those usable accounts instead of preserving dead placeholders.
      const config = localPublishingAccountMocksEnabled() && resolved
        ? { ...snapshot, companyName: resolved.config.companyName, publishingTargets: resolved.config.publishingTargets }
        : snapshot;
      const currentPackage = plan ? jsonObject<{ businessPackage?: WeeklyPackage }>(plan.plan, {}).businessPackage : undefined;
      const planBody = plan ? jsonObject<Record<string, unknown>>(plan.plan, {}) : {};
      const savedFactsVersion = String(jsonObject<Record<string, unknown>>(planBody.knowledgeBinding, {}).factsVersion || '').trim();
      if (savedFactsVersion && resolved && savedFactsVersion !== resolved.knowledgeBinding.factsVersion) {
        res.status(409).json({ error: 'enterprise_facts_changed', message: '企业资料已更新，请同步并重新确认周计划。', ...weeklyGoalFactRebuildRecovery(goal, plan!, savedFactsVersion, resolved.knowledgeBinding.factsVersion) });
        return;
      }
      const enterpriseProfile = frozenEnterpriseProfileForPlan(plan, false)
        || (resolved ? enterpriseProfileFromKnowledgeBinding(resolved.knowledgeBinding) as EnterpriseProfile | null : null);
      if (!enterpriseProfile) { res.status(409).json({ error: 'enterprise_fact_snapshot_missing' }); return; }
      const members = await listTenantEmployees(res.locals as AuthLocals, req.headers.authorization);
      const member = members.find(m => m.id === userId);
      const proposal = await recommendPackageWithTenantEvidence(tenantId, goalInput(goal), { ...config, operatingMaturity: currentPackage?.maturity || config.operatingMaturity, operatingAssessment: currentPackage?.operatingAssessment || config.operatingAssessment, defaultParticipation: currentPackage?.participation || config.defaultParticipation }, userId, member?.name, enterpriseProfile);
      proposal.revision = currentPackage?.revision || 0;
      res.json(proposal);
    });
  }

  function registerPostGoalsGoalIdPackageDetails() {
    digitalEmployeesRouter.post('/goals/:goalId/package/details', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      try {
      await withLocalQueue(goalApprovalQueues, `${tenantId}:package-details:${req.params.goalId}`, async () => {
        const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, req.params.goalId, tenantId);
        if (!goal || goal.status !== 'draft') {
          res.status(409).json({ error: 'draft_required', message: '只有待确认的周视频计划可以生成制作准备。' });
          return;
        }
        if (!await weeklyGoalFactRebuildTargetCommitted(tenantId, goal)) {
          res.status(409).json({ error: 'goal_fact_rebuild_not_committed', message: '最新事实周目标尚未完成安全替换，暂不能修改。' });
          return;
        }
        const run = await first<RunRecord>(COLLECTION.runs, { tenant_id: tenantId, goal_id: goal.id }, '-started_at');
        if (run) {
          res.status(409).json({ error: 'package_locked', message: '计划已经开始执行，不能重新生成任务预览。' });
          return;
        }
        const plan = await first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: goal.id });
        if (!plan) { res.status(404).json({ error: 'plan_not_found' }); return; }
        const observedPlanPayload = plan.plan;
        const planBody = jsonObject<Record<string, unknown>>(plan.plan, {});
        if (plan.status !== 'draft' || hasWeeklyGoalFactRebuildPlanFence(planBody)) {
          res.status(409).json({ error: 'package_locked', message: '计划正在发生状态变更，请刷新后重试。' }); return;
        }
        const pack = planBody.businessPackage ? repairCollapsedWeeklyVideoProduction(planBody.businessPackage as WeeklyPackage) : undefined;
        if (!pack) { res.status(409).json({ error: 'weekly_package_missing', message: '请先制定本周目标和视频计划。' }); return; }
        const configRecord = await configForTenant(tenantId);
        const currentConfig = publicConfig(configRecord);
        if (!currentConfig) { res.status(409).json({ error: 'onboarding_required' }); return; }
        const resolvedConfiguration = await resolveCurrentConfiguration(tenantId, configRecord);
        const savedFactsVersion = String(jsonObject<Record<string, unknown>>(planBody.knowledgeBinding, {}).factsVersion || '').trim();
        if (savedFactsVersion && resolvedConfiguration && savedFactsVersion !== resolvedConfiguration.knowledgeBinding.factsVersion) {
          res.status(409).json({ error: 'enterprise_facts_changed', message: '企业资料已更新，请同步并重新确认周计划。', ...weeklyGoalFactRebuildRecovery(goal, plan, savedFactsVersion, resolvedConfiguration.knowledgeBinding.factsVersion) });
          return;
        }
        if (resolvedConfiguration && !frozenEnterpriseProfileForPlan(plan, false)) {
          planBody.knowledgeBinding = resolvedConfiguration.knowledgeBinding;
          plan.plan = planBody;
        }
        const config = localPublishingAccountMocksEnabled() && resolvedConfiguration
          ? resolvedConfiguration.config
          : configSnapshotForPlan(plan, currentConfig);
        if (config.smartOperationsEnabled === false) {
          res.status(409).json({ error: 'smart_operations_disabled', message: '智能经营已关闭；开启后才能生成新的 Agent 任务详情。' });
          return;
        }
        const currentPlans = pack.tasks.find(task => task.templateId === 'production')?.videoPlans || [];
        const currentMasterPlans = currentPlans.filter(item => item.productionRole !== 'platform_adaptation');
        const productionProfile = frozenEnterpriseProfileForPlan(plan, false)
          || (resolvedConfiguration ? enterpriseProfileFromKnowledgeBinding(resolvedConfiguration.knowledgeBinding) as EnterpriseProfile | null : null);
        if (!productionProfile) {
          res.status(409).json({ error: 'enterprise_fact_snapshot_missing', message: '企业事实快照缺失，请重新确认企业与产品资料后再生成制作详情。' });
          return;
        }
        let preparationReadiness: Awaited<ReturnType<typeof readServerProductionOnboardingReadiness>>;
        try {
          preparationReadiness = await readServerProductionOnboardingReadiness({
            store,
            tenantId,
            profile: productionProfile,
            preferences: config.productionOnboarding,
            plans: currentMasterPlans,
            // Budget is finalized after the storyboard quote. This first gate checks
            // only zero-cost enterprise, presenter and local-material prerequisites.
            budgetConfirmed: true,
          });
        } catch (error) {
          res.status(503).json({
            error: 'production_onboarding_preflight_unavailable',
            message: `${error instanceof Error ? error.message : '生产资料预检暂时不可用'}；本次未调用制作服务，请稍后重试。`,
          });
          return;
        }
        if (!preparationReadiness.ready) {
          res.status(409).json({
            error: 'production_onboarding_preflight_blocked',
            message: `制作详情尚未生成：${preparationReadiness.blockers.map(item => item.message).join('；')}`,
            blockers: preparationReadiness.blockers,
            requiredArchetypes: preparationReadiness.requiredArchetypes,
          });
          return;
        }
        if (pack.detailGeneration?.status === 'ready' && currentMasterPlans.length > 0
          && currentMasterPlans.every(item => item.preproduction?.readiness.canStart)) {
          res.json(await buildOverview(tenantId, goal.id));
          return;
        }
        const lease = await acquireDurableOperationLease({
          dataStore: store, tenantId, scope: 'weekly_package_details', subjectId: goal.id,
          ownerId: `weekly-details-${randomUUID()}`, leaseDurationMs: 30 * 60_000,
        });
        if (!lease) {
          res.status(202).json(await buildOverview(tenantId, goal.id));
          return;
        }
        try {
          const startedAt = new Date().toISOString();
          const generatingPack: WeeklyPackage = {
            ...pack,
            detailGeneration: {
              status: 'generating', startedAt, generatedAt: '',
              estimatedMinutes: Math.max(2, Math.ceil(currentMasterPlans.length / 2) * 2), usageCostCny: null,
              readyCount: 0, blockedCount: 0, blockers: [],
            },
          };
          const generatingPlan = { ...planBody, businessPackage: generatingPack };
          if (!store.compareAndSwap || !await store.compareAndSwap(COLLECTION.plans, plan.id, {
            tenant_id: tenantId, goal_id: goal.id, status: 'draft', plan: observedPlanPayload,
          }, { plan: generatingPlan })) {
            res.status(503).json({ error: 'weekly_plan_storage_unavailable' });
            return;
          }
          try {
            const detailed = await generateWeeklyTaskPreviews({ tenantId, goal, plan, pack: generatingPack, config, planBody: generatingPlan });
            await assertDurableOperationLease({ dataStore: store, lease, minimumRemainingMs: 1_000 });
            const compiled = compilePackage(detailed, goalInput(goal), config);
            if (!await store.compareAndSwap!(COLLECTION.plans, plan.id, {
              tenant_id: tenantId, goal_id: goal.id, status: 'draft', plan: generatingPlan,
            }, { plan: { ...generatingPlan, ...compiled } })) {
              throw new Error('周任务详情保存失败，请重试');
            }
            await appendAudit({
              tenantId, userId, action: 'weekly_package.details_generated', targetType: 'weekly_plan', targetId: plan.id,
              metadata: {
                revision: detailed.revision,
                readyCount: detailed.detailGeneration?.readyCount || 0,
                blockedCount: detailed.detailGeneration?.blockedCount || 0,
                usageCostCny: detailed.detailGeneration?.usageCostCny ?? null,
              },
            });
            res.json(await buildOverview(tenantId, goal.id));
          } catch (error) {
            const reason = error instanceof Error ? error.message : '任务详情生成失败';
            const blockedPack: WeeklyPackage = {
              ...generatingPack,
              detailGeneration: {
                ...generatingPack.detailGeneration!, status: 'blocked', generatedAt: new Date().toISOString(),
                readyCount: 0, blockedCount: currentMasterPlans.length, blockers: [reason.slice(0, 500)],
              },
            };
            await store.compareAndSwap!(COLLECTION.plans, plan.id, {
              tenant_id: tenantId, goal_id: goal.id, status: 'draft', plan: generatingPlan,
            }, { plan: { ...generatingPlan, businessPackage: blockedPack } }).catch(() => false);
            res.status(503).json({ error: 'weekly_package_detail_generation_failed', message: `${reason}。已保留周视频计划，可修复后重试。` });
          }
        } finally {
          await releaseDurableOperationLease({ dataStore: store, lease }).catch(() => undefined);
        }
      });
      } catch (error) {
        if (res.headersSent) return;
        const code = error instanceof Error && /local_store_atomic_lock_busy_reconciliation_required|durable_lease_storage_unavailable/.test(error.message)
          ? 'local_store_reconciliation_required' : 'weekly_package_detail_service_unavailable';
        console.error('[weekly-package] detail request failed', { code, goalId: req.params.goalId });
        res.status(503).json({ error: code, message: code === 'local_store_reconciliation_required'
          ? '本地任务存储写锁需要核对；原计划已保留，请勿重复提交或启动付费制作。'
          : '任务详情暂时无法读取或保存；原计划已保留，请查看原任务状态。' });
      }
    });
  }

  function registerPutGoalsGoalIdPackage() {
    digitalEmployeesRouter.put('/goals/:goalId/package', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      await withLocalQueue(goalApprovalQueues, `${tenantId}:activate`, async () => {
        const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, req.params.goalId, tenantId);
        if (!goal) { res.status(404).json({ error: 'goal_not_found' }); return; }
        if (!await weeklyGoalFactRebuildTargetCommitted(tenantId, goal)) {
          res.status(409).json({ error: 'goal_fact_rebuild_not_committed', message: '最新事实周目标尚未完成安全替换，暂不能修改。' }); return;
        }
        const run = await first<RunRecord>(COLLECTION.runs, { tenant_id: tenantId, goal_id: goal.id }, '-started_at');
        if (goal.status !== 'draft' || run) { res.status(409).json({ error: 'package_locked', message: '计划已启动，请在执行任务中处理调整。' }); return; }
        const plan = await first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: goal.id });
        if (!plan) { res.status(404).json({ error: 'plan_not_found' }); return; }
        const body = jsonObject<Record<string, unknown>>(plan.plan, {});
        if (plan.status !== 'draft' || hasWeeklyGoalFactRebuildPlanFence(body)) {
          res.status(409).json({ error: 'package_locked', message: '计划正在发生状态变更，请刷新后重试。' }); return;
        }
        let pack: WeeklyPackage;
        try { pack = normalizePackage(req.body); } catch (e) { res.status(400).json({ error: String(e) }); return; }
        if (new Set(pack.tasks.map(t => t.templateId)).size !== pack.tasks.length || pack.tasks.some(t => !TASK_TEMPLATES.some(template => template.id === t.templateId))) { res.status(400).json({ error: 'invalid_templates' }); return; }
        const old = body.businessPackage as WeeklyPackage | undefined;
        if (pack.revision !== (old?.revision || 0)) { res.status(409).json({ error: 'package_changed', message: '计划已更新，请刷新后重新调整。' }); return; }
        // The collection boundary is server-owned and frozen with the draft;
        // older clients must not remove it while editing unrelated fields.
        if (old?.referenceSourcePolicy === 'existing_library_only') pack.referenceSourcePolicy = 'existing_library_only';
        // Drafts may contain missing dependencies so deleting a producer can be
        // followed by selecting an existing input. Execution validates completeness.
        const members = await listTenantEmployees(res.locals as AuthLocals, req.headers.authorization);
        if (pack.tasks.some(t => t.ownerId && !members.some(m => m.id === t.ownerId))) { res.status(400).json({ error: 'invalid_owner', message: '负责人必须是当前企业成员。' }); return; }
        for (const task of pack.tasks) task.ownerName = members.find(m => m.id === task.ownerId)?.name || '';
        const configRecord = await configForTenant(tenantId);
        const currentConfig = publicConfig(configRecord);
        if (!currentConfig) { res.status(409).json({ error: 'onboarding_required' }); return; }
        const resolvedConfiguration = await resolveCurrentConfiguration(tenantId, configRecord);
        const savedFactsVersion = String(jsonObject<Record<string, unknown>>(body.knowledgeBinding, {}).factsVersion || '').trim();
        if (savedFactsVersion && resolvedConfiguration && savedFactsVersion !== resolvedConfiguration.knowledgeBinding.factsVersion) {
          res.status(409).json({ error: 'enterprise_facts_changed', message: '企业资料已更新，请同步并重新确认周计划。', ...weeklyGoalFactRebuildRecovery(goal, plan, savedFactsVersion, resolvedConfiguration.knowledgeBinding.factsVersion) });
          return;
        }
        const config = localPublishingAccountMocksEnabled() && resolvedConfiguration
          ? resolvedConfiguration.config
          : configSnapshotForPlan(plan, currentConfig);
        if (pack.authorization.accountIds.some(id => !config.publishingTargets.some(t => t.accountId === id))) { res.status(400).json({ error: 'invalid_account_scope', message: '请选择本计划绑定的发布账号。' }); return; }
        if (pack.matrixPlan?.some(row => !goalInput(goal).contentPlatforms.includes(row.platform) || (row.connected !== false && !config.publishingTargets.some(target => target.accountId === row.accountId && target.platform === row.platform)))) { res.status(400).json({ error: 'invalid_matrix_account', message: '矩阵账号必须属于本计划及本周平台范围。' }); return; }
        const customerIds = new Set((await getWhatsAppCustomers(tenantId)).map(c => c.id));
        if (pack.authorization.customerIds.some(id => !customerIds.has(id))) { res.status(400).json({ error: 'invalid_customer_scope' }); return; }
        for (const id of [...new Set([...pack.tasks.flatMap(t => t.sourceProjectIds), ...(pack.matrixPlan || []).flatMap(row => row.sourceProjectIds)])]) {
          const project = await tenantRecord<StoredRecord & { tenant_id: string }>('studio_projects', id, tenantId);
          if (!project || !studioProjectRendered(project)) { res.status(400).json({ error: 'invalid_source_project', message: '已有作品不可用，请重新选择。' }); return; }
        }
        // A matrix, product, budget or content edit invalidates previous
        // pre-production evidence. Publication copy is regenerated from the same
        // frozen weekly plan so title/caption/tags stay aligned with the product.
        delete pack.detailGeneration;
        for (const task of pack.tasks) {
          if (task.templateId !== 'production') continue;
          task.videoPlans = (task.videoPlans || []).map(source => {
            const videoPlan = normalizeVideoPlan(source);
            delete videoPlan.preproduction;
            videoPlan.publication = publicationCopyForPlan({
              plan: videoPlan,
              productName: videoPlan.productName,
              theme: videoPlan.planningEvidence?.referenceTitle || videoPlan.theme,
            });
            return videoPlan;
          });
        }
        pack.revision = (old?.revision || 0) + 1;
        const compiled = compilePackage(pack, goalInput(goal), config);
        const needsFactSnapshot = !savedFactsVersion || !frozenEnterpriseProfileForPlan(plan, false);
        const localConfigurationSnapshot = resolvedConfiguration
          ? localPublishingAccountMocksEnabled()
            ? configurationSnapshot(resolvedConfiguration)
            : needsFactSnapshot
              ? { knowledgeBinding: resolvedConfiguration.knowledgeBinding }
              : {}
          : {};
        if (!store.compareAndSwap || !await store.compareAndSwap(COLLECTION.plans, plan.id, {
          tenant_id: tenantId, goal_id: goal.id, status: 'draft', plan: plan.plan,
        }, { plan: { ...body, ...localConfigurationSnapshot, ...compiled } })) {
          res.status(409).json({ error: 'package_changed', message: '计划已更新或正在重建，请刷新后重新调整。' }); return;
        }
        await appendAudit({ tenantId, userId, action: 'weekly_package.updated', targetType: 'weekly_plan', targetId: plan.id, metadata: { revision: pack.revision, tasks: pack.tasks } });
        res.json(await buildOverview(tenantId, goal.id));
      });
    });
  }

  function registerPatchGoalsGoalIdProductionBudgetMode() {
    digitalEmployeesRouter.patch('/goals/:goalId/production-budget-mode', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      const mode = req.body?.mode === 'economy' ? 'economy' as const
        : req.body?.mode === 'protected' ? 'protected' as const : null;
      const expectedRevision = Number(req.body?.packageRevision);
      if (!mode || !Number.isInteger(expectedRevision)) {
        res.status(400).json({ error: 'production_budget_mode_invalid', message: '请选择有效的开工预算方案。' }); return;
      }
      await withLocalQueue(goalApprovalQueues, `${tenantId}:activate`, async () => {
        const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, req.params.goalId, tenantId);
        const plan = goal ? await first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: goal.id }) : null;
        const run = goal ? await first<RunRecord>(COLLECTION.runs, { tenant_id: tenantId, goal_id: goal.id }, '-started_at') : null;
        if (!goal || !plan) { res.status(404).json({ error: 'weekly_plan_not_found', message: '没有找到对应的周计划。' }); return; }
        if (goal.status !== 'draft' || plan.status !== 'draft' || run) {
          res.status(409).json({ error: 'production_budget_locked', message: '计划已开工，预算授权不能在生产中途静默变更。' }); return;
        }
        const body = jsonObject<Record<string, unknown>>(plan.plan, {});
        const pack = body.businessPackage ? repairCollapsedWeeklyVideoProduction(body.businessPackage as WeeklyPackage) : undefined;
        if (!pack?.directorPlan || pack.revision !== expectedRevision) {
          res.status(409).json({ error: 'package_changed', message: '计划已更新，请重新核对预算后再选择。' }); return;
        }
        const masters = pack.tasks.find(task => task.templateId === 'production')?.videoPlans?.filter(item => item.productionRole !== 'platform_adaptation') || [];
        const productionBudgetMin = Math.round(masters.reduce((sum, item) => sum + Number(item.estimatedCostRange?.minCny || 0), 0) * 100) / 100;
        const productionBudgetMax = Math.round(masters.reduce((sum, item) => sum + Number(item.estimatedCostRange?.maxCny || 0), 0) * 100) / 100;
        const verified = masters.length > 0 && masters.every(item => item.estimatedCostRange?.basis === 'verified_storyboard_provider_envelope');
        if (!verified || productionBudgetMin <= 0 || productionBudgetMax < productionBudgetMin) {
          res.status(409).json({ error: 'production_budget_forecast_required', message: '可靠预算尚未生成，请先完成周计划详情准备后再选择开工方案。' }); return;
        }
        const nextPack: WeeklyPackage = {
          ...pack,
          revision: pack.revision + 1,
          directorPlan: {
            ...pack.directorPlan,
            productionBudgetMode: mode,
            productionBudget: mode === 'economy' ? productionBudgetMin : productionBudgetMax,
            productionBudgetMin,
            productionBudgetMax,
            productionReserved: 0,
          },
        };
        const configRecord = await configForTenant(tenantId);
        const currentConfig = publicConfig(configRecord);
        if (!currentConfig) { res.status(409).json({ error: 'onboarding_required' }); return; }
        const config = executionConfigForPlan(plan, currentConfig);
        const compiled = compilePackage(nextPack, goalInput(goal), config);
        if (!store.compareAndSwap || !await store.compareAndSwap(COLLECTION.plans, plan.id, {
          tenant_id: tenantId, goal_id: goal.id, status: 'draft', plan: plan.plan,
        }, { plan: { ...body, ...compiled } })) {
          res.status(409).json({ error: 'package_changed', message: '计划刚刚发生变化，请刷新后重新选择。' }); return;
        }
        await appendAudit({ tenantId, userId, action: 'weekly_package.production_budget_mode_selected', targetType: 'weekly_plan', targetId: plan.id,
          metadata: { revision: nextPack.revision, mode, productionBudgetMin, productionBudgetMax, approvedCeilingCny: nextPack.directorPlan!.productionBudget } });
        res.json(await buildOverview(tenantId, goal.id));
      });
    });
  }

  function registerPatchGoalsGoalIdPublicationScheduleContentId() {
    digitalEmployeesRouter.patch('/goals/:goalId/publication-schedule/:contentId', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      const goalId = String(req.params.goalId || '').trim();
      const contentId = String(req.params.contentId || '').trim();
      const scheduledAt = String(req.body?.scheduledAt || '').trim();
      if (!contentId || contentId.length > 160 || !/(?:Z|[+-]\d{2}:\d{2})$/.test(scheduledAt) || !Number.isFinite(Date.parse(scheduledAt))) {
        res.status(400).json({ error: 'publication_schedule_invalid', message: '请选择有效的发布日期和时间。' }); return;
      }
      await withLocalQueue(goalApprovalQueues, `${tenantId}:publication-schedule:${goalId}`, async () => {
        const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, goalId, tenantId);
        const plan = await first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: goalId });
        if (!goal || !plan) { res.status(404).json({ error: 'weekly_plan_not_found', message: '没有找到对应的周计划。' }); return; }
        const publishDate = beijingDate(new Date(scheduledAt));
        if (publishDate < goal.starts_at || publishDate > goal.ends_at) {
          res.status(400).json({ error: 'publication_schedule_outside_cycle', message: `发布时间必须在本周周期 ${goal.starts_at} 至 ${goal.ends_at} 内。` }); return;
        }
        const run = await first<RunRecord>(COLLECTION.runs, { tenant_id: tenantId, goal_id: goalId }, '-started_at');
        if (run) {
          const workflow = await store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: run.id }, page: 1, perPage: 200 });
          const locked = workflow.items.find(task => ['content_release_approval', 'publishing_calendar', 'platform_publish'].includes(task.task_key)
            && !['pending', 'skipped', 'cancelled'].includes(task.status));
          if (locked) {
            res.status(409).json({ error: 'publication_schedule_locked', message: '这条内容已经进入发布审批或平台执行，请到发布与渠道中调整，避免重复发布。' }); return;
          }
        }
        const body = jsonObject<Record<string, unknown>>(plan.plan, {});
        const pack = body.businessPackage ? repairCollapsedWeeklyVideoProduction(body.businessPackage as WeeklyPackage) : undefined;
        const production = pack?.tasks.find(task => task.templateId === 'production');
        const matches = production?.videoPlans?.filter(video => video.contentId === contentId) || [];
        if (!pack || !production || matches.length !== 1) {
          res.status(404).json({ error: 'publication_content_not_found', message: '没有找到这条内容的发布安排，请刷新后重试。' }); return;
        }
        const nextPlans = production.videoPlans!.map(video => video.contentId === contentId
          ? normalizeVideoPlan({ ...video, plannedPublishDate: publishDate, plannedPublishAt: scheduledAt })
          : video);
        const nextPack: WeeklyPackage = {
          ...pack,
          tasks: pack.tasks.map(task => task === production ? { ...task, videoPlans: nextPlans } : task),
        };
        const nextBody = { ...body, businessPackage: nextPack };
        if (!store.compareAndSwap || !await store.compareAndSwap(COLLECTION.plans, plan.id, {
          tenant_id: tenantId, goal_id: goalId, plan: plan.plan,
        }, { plan: nextBody })) {
          res.status(409).json({ error: 'publication_schedule_changed', message: '周计划刚刚发生变化，请刷新后再调整。' }); return;
        }
        const scope = jsonObject<Record<string, unknown>>(goal.scope, { description: typeof goal.scope === 'string' ? goal.scope : '' });
        const goalPlans = Array.isArray(scope.videoPlans) ? scope.videoPlans as VideoCreationPlan[] : [];
        if (goalPlans.some(video => video.contentId === contentId)) {
          await store.update(COLLECTION.goals, goal.id, {
            scope: { ...scope, videoPlans: goalPlans.map(video => video.contentId === contentId ? normalizeVideoPlan({ ...video, plannedPublishDate: publishDate, plannedPublishAt: scheduledAt }) : video) },
            updated_at: new Date().toISOString(),
          });
        }
        if (run) {
          const batch = await first<ContentBatchPlanRecord>(COLLECTION.contentBatchPlans, { tenant_id: tenantId, run_id: run.id });
          if (batch) {
            const orders = jsonObject<ContentOrder[]>(batch.orders, []);
            const nextOrders = orders.map(order => ({
              ...order,
              ...(order.videoPlan?.contentId === contentId ? { videoPlan: normalizeVideoPlan({ ...order.videoPlan, plannedPublishDate: publishDate, plannedPublishAt: scheduledAt }) } : {}),
              ...(order.deliveryVariants?.some(variant => variant.contentId === contentId) ? { deliveryVariants: order.deliveryVariants.map(variant => variant.contentId === contentId ? { ...variant, plannedPublishDate: publishDate, plannedPublishAt: scheduledAt } : variant) } : {}),
            }));
            await store.update(COLLECTION.contentBatchPlans, batch.id, { orders: nextOrders, updated_at: new Date().toISOString() });
          }
        }
        await appendAudit({ tenantId, userId, action: 'weekly_publication.rescheduled', targetType: 'weekly_content', targetId: contentId, metadata: { goalId, planId: plan.id, scheduledAt, publishDate, timeZone: 'Asia/Shanghai' } });
        res.json(await buildOverview(tenantId, goalId));
      });
    });
  }

  return { registerGetPlanningOptions, registerGetPackageOptions, registerGetGoalsGoalIdProductionReadiness, registerPostGoalsGoalIdPackageRecommend, registerPostGoalsGoalIdPackageDetails, registerPutGoalsGoalIdPackage, registerPatchGoalsGoalIdProductionBudgetMode, registerPatchGoalsGoalIdPublicationScheduleContentId };
}
