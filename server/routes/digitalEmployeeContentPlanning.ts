import { store } from '../storage/index.js';
import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, jsonObject, type ContentBatchPlanRecord, type GoalRecord, type PlanRecord, type RunRecord, type StoredRecord, type TaskRecord } from './digitalEmployeeRecords.js';
import type { DigitalEmployeeConfig, WeeklyGoalInput } from '../digitalEmployees/domain.js';
import type { EnterpriseProfile } from './enterprise.js';
import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import { normalizeVideoPlan, videoPlanErrors, type VideoCreationPlan, type VideoPreproductionPreview } from '../../shared/contracts/videoCreationPlan.js';
import { buildContentBatchPlan, contentPlanCoverage, type ContentBatchPlanDraft, type ContentOrder } from '../digitalEmployees/contentBatchPlan.js';
import { collectProductionAssets, generateDirectorScriptContracts } from '../digitalEmployees/contentProduction.js';
import { buildBenchmarkAnalysis } from '../../shared/benchmarkAnalysis.js';
import { assessStoryboardMaterialReadiness } from '../digitalEmployees/materialProductionReadiness.js';
import { MATERIAL_TYPE_LABELS } from '../../shared/benchmarkAnalysis.js';

interface ContentPlanningDependencies {
  first<T extends StoredRecord>(collection: string, where: Record<string, string | number | boolean>, sort?: string): Promise<T | null>;
  requiredCreate<T extends StoredRecord>(collection: string, payload: Record<string, unknown>): Promise<T>;
  ensureFrozenEnterpriseProfileForRun(tenantId: string, plan: PlanRecord | null, config: DigitalEmployeeConfig, boundAt: string): Promise<EnterpriseProfile>;
  goalInput(goal: GoalRecord): WeeklyGoalInput;
  contentRoutingEvidence(tenantId: string, config: DigitalEmployeeConfig, profile?: EnterpriseProfile): Promise<any>;
}

export function createDigitalEmployeeContentPlanning(deps: ContentPlanningDependencies) {
  const { first, requiredCreate, ensureFrozenEnterpriseProfileForRun, goalInput, contentRoutingEvidence } = deps;
  function collectionLimitForInventoryGap(task: TaskRecord, fallback: number): number {
    const output = jsonObject<Record<string, unknown>>(task.output, {});
    const inventory = jsonObject<Record<string, unknown>>(output.inventoryPreflight, {});
    const missingCount = Number(inventory.missingCount);
    return Number.isSafeInteger(missingCount) && missingCount > 0
      ? Math.max(1, Math.min(fallback, missingCount))
      : fallback;
  }

  function sourceCollectionFailureReason(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error || '');
    if (/source.?quote|evidence.?quote|keyword.*(?:source|evidence)|关键词.*(?:来源|证据)/i.test(message)) {
      return '采集关键词的来源证据格式不完整。计划和库存结果已经保留；从当前节点重试会自动修复格式后继续。';
    }
    if (/(?:401|403|unauthori[sz]ed|forbidden|credential|token expired|授权.*失效)/i.test(message)) {
      return '平台采集授权当前不可用。请检查采集账号或密钥后，从当前节点重试。';
    }
    if (/(?:429|rate.?limit|quota|额度|频率限制)/i.test(message)) {
      return '平台采集额度或调用频率已受限。稍后从当前节点重试，或重新规划本周任务。';
    }
    if (/(?:timeout|timed out|超时)/i.test(message)) {
      return '平台采集本轮等待超时。现有库存和已完成结果不会丢失，可以从当前节点重试。';
    }
    if (/(?:network|fetch failed|browser closed|connection|网络|连接)/i.test(message)) {
      return '平台采集连接中断。现有库存和已完成结果不会丢失，可以从当前节点重试。';
    }
    return '平台采集本轮没有返回可用结果。现有库存和已完成结果不会丢失，可以从当前节点重试或重新规划。';
  }

  function publicPreviewUrl(value: unknown): string {
    const candidate = String(value || '').trim().slice(0, 2_000);
    return /^(?:https?:\/\/|\/api\/|\/media\/|\/covers\/|\/generated\/)/i.test(candidate) ? candidate : '';
  }

  function directorShotSummary(script: string): string[] {
    return script.split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => /^(?:镜头功能|画面|台词|字幕)[：:]/.test(line))
      .slice(0, 8)
      .map(line => line.slice(0, 500));
  }

  function previewForBlockedPlan(input: {
    plan: VideoCreationPlan;
    generatedAt: string;
    blockers: string[];
    reference?: StoredRecord;
  }): VideoPreproductionPreview {
    const analysis = jsonObject<Record<string, unknown>>(input.reference?.aiAnalysis, {});
    const thumbnailUrl = publicPreviewUrl(input.reference?.thumbnailUrl || input.reference?.thumbnail);
    const sourceUrl = publicPreviewUrl(input.reference?.sourceUrl);
    const blockers = [...new Set(input.blockers.filter(Boolean))];
    return {
      version: 1,
      status: 'blocked',
      generatedAt: input.generatedAt,
      benchmark: {
        status: input.plan.referenceId ? input.reference ? 'ready' : 'missing' : input.plan.route === 'clone' ? 'missing' : 'not_applicable',
        referenceId: input.plan.referenceId,
        title: String(input.reference?.title || input.plan.planningEvidence?.referenceTitle || '').trim(),
        account: String(input.plan.planningEvidence?.benchmarkAccount || analysis.sourceAccountName || analysis.author || '').trim(),
        views: String(input.plan.planningEvidence?.referenceViews || input.reference?.views || '').trim(),
        thumbnailUrl,
        sourceUrl,
        hook: input.plan.buyerProblem || input.plan.theme,
        shotSummary: [],
      },
      materials: { status: 'blocked', items: [], storyboard: [], blockers, pendingShootTaskIds: [] },
      readiness: { canStart: false, blockers },
      confidence: { onTimeRate: null, effectLevel: 'insufficient', reasons: ['制作条件尚未补齐，不展示虚构成功率'] },
    };
  }

  async function generateWeeklyTaskPreviews(input: {
    tenantId: string;
    goal: GoalRecord;
    plan: PlanRecord;
    pack: WeeklyPackage;
    config: DigitalEmployeeConfig;
    planBody: Record<string, unknown>;
  }): Promise<WeeklyPackage> {
    const goal = goalInput(input.goal);
    const production = input.pack.tasks.find(task => task.templateId === 'production');
    const plans = production?.videoPlans || [];
    const masterPlans = plans.filter(plan => plan.productionRole !== 'platform_adaptation');
    if (!production || !plans.length) throw new Error('周视频计划中还没有内容任务');
    const generatedAt = new Date().toISOString();
    if (input.pack.referenceSourcePolicy === 'existing_library_only') {
      const cloneMasters = masterPlans.filter(plan => plan.route === 'clone');
      const unboundCount = cloneMasters.filter(plan => !plan.referenceId).length;
      if (unboundCount) {
        const blocker = `本周 ${cloneMasters.length} 条复刻视频中有 ${unboundCount} 条尚未绑定通过逐镜精确分析的爆款参考；请先在灵感集市完成分析，再重新匹配本周计划`;
        return { ...input.pack,
          detailGeneration: { status: 'blocked', startedAt: generatedAt, generatedAt,
            estimatedMinutes: 0, usageCostCny: null, readyCount: 0,
            blockedCount: unboundCount, blockers: [blocker] },
          tasks: input.pack.tasks.map(task => task.templateId !== 'production' ? task : { ...task,
            videoPlans: (task.videoPlans || []).map(plan => plan.referenceId ? plan : normalizeVideoPlan({ ...plan,
              preproduction: previewForBlockedPlan({ plan, generatedAt, blockers: [blocker] }),
            })),
          }),
        };
      }
    }
    const frozenProfile = await ensureFrozenEnterpriseProfileForRun(
      input.tenantId,
      input.plan,
      input.config,
      String(input.plan.created_at || generatedAt),
    );
    const frozenPlanBody = jsonObject<Record<string, unknown>>(input.plan.plan, input.planBody);
    const versions = {
      configVersion: Number(frozenPlanBody.configVersion || 1),
      policyVersion: String(frozenPlanBody.policyVersion || 'unknown'),
      factsVersion: String(jsonObject<Record<string, unknown>>(frozenPlanBody.knowledgeBinding, {}).factsVersion || 'unknown'),
    };
    const [evidence, profile, references, shootingRows] = await Promise.all([
      contentRoutingEvidence(input.tenantId, input.config, frozenProfile),
      Promise.resolve(structuredClone(frozenProfile)),
      store.list<StoredRecord>('trend_videos', { where: { tenantId: input.tenantId }, sort: '-updatedAt', perPage: 500 }),
      store.list<StoredRecord>('studio_shooting_tasks', { where: { tenant_id: input.tenantId }, sort: '-created_at', perPage: 500 }).catch(() => ({ items: [] })),
    ]);
    const draft = buildContentBatchPlan({ goalId: input.goal.id, goal: { ...goal, videoPlans: plans }, config: input.config, evidence, versions });
    if (draft.status === 'blocked') {
      const blockedPlans = plans.map(plan => normalizeVideoPlan({
        ...plan,
        preproduction: previewForBlockedPlan({
          plan,
          generatedAt,
          blockers: [...videoPlanErrors(plan), draft.blocker || '内容 Agent 未找到可执行素材组合'],
          reference: references.items.find(item => item.id === plan.referenceId),
        }),
      }));
      return {
        ...input.pack,
        detailGeneration: {
          status: 'blocked', startedAt: generatedAt, generatedAt,
          estimatedMinutes: Math.max(2, Math.ceil(masterPlans.length / 2) * 2), usageCostCny: null,
          readyCount: 0, blockedCount: masterPlans.length, blockers: [draft.blocker].filter(Boolean),
        },
        tasks: input.pack.tasks.map(task => task.templateId === 'production' ? { ...task, videoPlans: blockedPlans } : task),
      };
    }

    const assets = await collectProductionAssets(input.tenantId, profile);
    const assetById = new Map(assets.map(asset => [asset.id, asset]));
    const pendingShooting = shootingRows.items.map(row => ({ row, payload: jsonObject<Record<string, unknown>>(row.payload, {}) }))
      .filter(item => !jsonObject<string[]>(item.payload.uploadedMaterialIds, []).length);
    const budgetExceeded = Boolean(input.pack.directorPlan
      && input.pack.directorPlan.productionSpent + plans.reduce((sum, plan) => sum + Number(plan.estimatedCost || 0), 0) > (input.pack.directorPlan.productionBudgetMax || input.pack.directorPlan.productionBudget));

    const preflight = draft.orders.map(order => {
      const plan = order.videoPlan || masterPlans.find(item => item.contentId === order.videoPlan?.contentId);
      if (!plan) throw new Error(`生产订单 ${order.id} 缺少独立制作视频`);
      const reference = references.items.find(row => row.id === plan.referenceId);
      const analysis = jsonObject<Record<string, unknown>>(reference?.aiAnalysis, {});
      const benchmarkAnalysis = plan.benchmarkAnalysis || (reference ? buildBenchmarkAnalysis({
        analysis,
        videoId: reference.id,
        duration: Number(reference.duration || 0),
        evidenceRevision: String(reference.updatedAt || reference.updated_at || analysis.analysisRunId || `analysis:${reference.id}`),
      }) : undefined);
      const selectedAssets = order.evidenceRefs
        .filter(ref => ref.type === 'enterprise_material')
        .map(ref => assetById.get(ref.id))
        .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));
      const materialReadiness = assessStoryboardMaterialReadiness({
        analysis: benchmarkAnalysis,
        assets: selectedAssets,
        presenter: plan.presenter,
      });
      // Exact clone orders use the managed per-shot bridge. Product/factory
      // motion is generated or matched there, so the legacy editor's demand for
      // pre-existing dynamic footage must not stop the order before the bridge
      // can run. A missing static product identity asset remains a real blocker.
      const managedClone = plan.route === 'clone'
        && Boolean(reference)
        && analysis.analysisMode === 'exact'
        && ['video', 'video_review_required'].includes(String(analysis.analysisQuality || ''));
      const materialBlockers = managedClone
        ? materialReadiness.decisions
          .filter(decision => decision.requirement === 'static_product')
          .map(decision => decision.blocker)
          .filter(Boolean)
        : materialReadiness.blockers;
      const normalizedNeedle = `${plan.productName} ${plan.theme}`.toLowerCase();
      const shootTasks = pendingShooting.filter(item => {
        const label = `${item.payload.productLabel || ''} ${item.payload.themeTitle || ''}`.trim().toLowerCase();
        return Boolean(label && (normalizedNeedle.includes(label) || label.includes(plan.productName.toLowerCase())));
      });
      const unresolvedShootTasks = !managedClone && materialBlockers.length ? shootTasks : [];
      const blockers = [
        ...(order.readinessBlockers || []),
        ...videoPlanErrors(plan),
        ...materialBlockers,
        selectedAssets.some(asset => asset.authorization.status === 'unknown') ? '素材授权范围未确认' : '',
        unresolvedShootTasks.length ? `本条独立视频有 ${unresolvedShootTasks.length} 个待拍任务尚未回填素材` : '',
        budgetExceeded ? '本周预计制作成本超过生产预算' : '',
        plan.route === 'clone' && !references.items.some(item => item.id === plan.referenceId) ? '爆款参考不存在或已失效' : '',
      ].filter(Boolean);
      return { order, plan, reference, analysis, benchmarkAnalysis, materialReadiness, selectedAssets, shootTasks: unresolvedShootTasks, blockers: [...new Set(blockers)] };
    });
    const readyOrders = preflight.filter(item => !item.blockers.length).map(item => item.order);
    const directedOrders = readyOrders.length
      ? await generateDirectorScriptContracts({ tenantId: input.tenantId, config: input.config, goal, orders: readyOrders, now: generatedAt, enterpriseProfile: profile })
      : [];
    const directedById = new Map(directedOrders.map(order => [order.id, order]));
    const nextMasterPlans = preflight.map(item => {
      const { reference, analysis, benchmarkAnalysis } = item;
      const directed = directedById.get(item.order.id);
      const script = directed?.scripts?.[item.plan.language] || Object.values(directed?.scripts || {})[0];
      const materialItems: VideoPreproductionPreview['materials']['items'] = item.selectedAssets.map(asset => ({
        id: asset.id,
        name: asset.name,
        type: asset.type,
        previewUrl: publicPreviewUrl(asset.url),
        status: asset.authorization.status === 'unknown' ? 'needs_authorization' : 'ready',
      }));
      for (const shooting of item.shootTasks) materialItems.push({
        id: shooting.row.id,
        name: String(shooting.payload.title || '待拍素材'),
        type: 'video', previewUrl: '', status: 'pending_shoot',
      });
      const unusedAssets = [...item.selectedAssets];
      const assetForStructure = (materialType: keyof typeof MATERIAL_TYPE_LABELS, structureIndex: number) => {
        const readinessDecision = item.materialReadiness.decisions.find(decision => decision.structureIndex === structureIndex);
        const decidedId = readinessDecision?.assetId;
        const decided = decidedId ? item.selectedAssets.find(asset => asset.id === decidedId) : undefined;
        if (decided) return decided;
        // Required shots must never fall back to an incompatible asset. For
        // example, a product image cannot make a dynamic usage shot look ready.
        if (readinessDecision?.required) return undefined;
        if (materialType === 'unknown') return undefined;
        const keywords: Record<keyof typeof MATERIAL_TYPE_LABELS, RegExp> = {
          talking_head: /真人|口播|主播|人物|presenter|talking/i,
          factory: /工厂|生产|车间|设备|流水线|factory|production/i,
          product: /产品|商品|包装|展示|product|packaging/i,
          consumer_demo: /消费者|用户|使用|效果|试用|consumer|demo|before|after/i,
          general: /环境|道具|办公|生活|户外|街景|会议|展会|图形|动画|转场|environment|prop|office|lifestyle|outdoor|street|meeting|exhibition|graphic|animation|transition/i,
          unknown: /(?!)/,
        };
        const matchIndex = unusedAssets.findIndex(asset => keywords[materialType].test([asset.name, ...asset.tags, ...asset.visualObservations].join(' ')));
        const selectedIndex = matchIndex >= 0 ? matchIndex : unusedAssets.length ? 0 : -1;
        return selectedIndex >= 0 ? unusedAssets.splice(selectedIndex, 1)[0] : undefined;
      };
      const storyboard: VideoPreproductionPreview['materials']['storyboard'] = (benchmarkAnalysis?.structure || []).map((step, structureIndex) => {
        const shot = step.shotIds.map(id => benchmarkAnalysis?.shots.find(item => item.shotId === id)).find(Boolean);
        const asset = assetForStructure(step.materialType, structureIndex);
        const readinessDecision = item.materialReadiness.decisions.find(decision => decision.structureIndex === structureIndex);
        const status = readinessDecision?.resolution === 'needs_input'
          ? 'missing' as const
          : asset
          ? asset.authorization.status === 'unknown' ? 'needs_authorization' as const : 'ready' as const
          : readinessDecision?.resolution === 'system_fallback' || readinessDecision?.resolution === 'optional'
            ? 'system_planned' as const
            : 'missing' as const;
        return {
          materialType: step.materialType,
          materialLabel: MATERIAL_TYPE_LABELS[step.materialType],
          narrativeRole: step.narrativeRole,
          shotIds: step.shotIds,
          referenceFirstFrameUrl: publicPreviewUrl(shot?.firstFrameRef),
          materialId: asset?.id || '',
          materialPreviewUrl: publicPreviewUrl(asset?.url),
          status,
          supplyMode: readinessDecision?.resolution,
          supplyRoute: readinessDecision?.productionRoute,
          supplyNote: readinessDecision?.productionNote,
        };
      });
      const benchmarkStatus: VideoPreproductionPreview['benchmark']['status'] = item.plan.referenceId
        ? reference ? 'ready' : 'missing'
        : item.plan.route === 'clone' ? 'missing' : 'not_applicable';
      const blockers = [...item.blockers];
      if (!script && !blockers.length) blockers.push('编导 Agent 未返回可执行分镜，请重试本步骤');
      const exactReference = benchmarkStatus === 'ready' && jsonObject<Record<string, unknown>>(analysis, {}).analysisMode === 'exact';
      const canStart = blockers.length === 0 && Boolean(script);
      const preview: VideoPreproductionPreview = {
        version: 1,
        status: canStart ? 'ready' : 'blocked',
        generatedAt,
        benchmark: {
          status: benchmarkStatus,
          referenceId: item.plan.referenceId,
          title: String(reference?.title || item.plan.planningEvidence?.referenceTitle || '').trim(),
          account: String(item.plan.planningEvidence?.benchmarkAccount || analysis.sourceAccountName || analysis.author || '').trim(),
          views: String(item.plan.planningEvidence?.referenceViews || reference?.views || '').trim(),
          thumbnailUrl: publicPreviewUrl(reference?.thumbnailUrl || reference?.thumbnail),
          sourceUrl: publicPreviewUrl(reference?.sourceUrl),
          hook: item.plan.buyerProblem || item.plan.theme,
          shotSummary: script ? directorShotSummary(script.body) : [],
        },
        materials: {
          status: blockers.some(blocker => /素材|待拍|授权|产品图片|产品视频|动态产品|工厂|生产证据/.test(blocker)) ? 'blocked' : 'ready',
          items: materialItems,
          storyboard,
          blockers: blockers.filter(blocker => /素材|待拍|授权|产品图片|产品视频|动态产品|工厂|生产证据/.test(blocker)),
          pendingShootTaskIds: item.shootTasks.map(shooting => shooting.row.id),
        },
        readiness: { canStart, blockers },
        confidence: {
          onTimeRate: null,
          effectLevel: exactReference && item.selectedAssets.length ? 'medium' : item.selectedAssets.length ? 'low' : 'insufficient',
          reasons: [
            exactReference ? '已绑定可核验的全片精确分析' : '缺少可核验的历史效果样本',
            item.selectedAssets.length ? `已锁定 ${item.selectedAssets.length} 项真实素材` : '素材证据不足',
            '尚未发布，不把匹配度包装成爆款成功率',
          ],
        },
        ...(script ? { directorScript: script } : {}),
      };
      return normalizeVideoPlan({ ...item.plan, directorStatus: canStart ? 'script_approved' : 'blocked', preproduction: preview });
    });
    const masterByFamily = new Map(nextMasterPlans.map(plan => [plan.contentFamilyId || plan.contentId || '', plan]));
    const nextPlans = plans.map(plan => {
      const preparedMaster = masterByFamily.get(plan.contentFamilyId || plan.contentId || '');
      if (!preparedMaster) return normalizeVideoPlan(plan);
      if (plan.contentId === preparedMaster.contentId) return preparedMaster;
      return normalizeVideoPlan({
        ...plan,
        directorStatus: preparedMaster.directorStatus,
        benchmarkAnalysis: preparedMaster.benchmarkAnalysis,
        preproduction: preparedMaster.preproduction,
      });
    });
    const blocked = nextMasterPlans.filter(plan => !plan.preproduction?.readiness.canStart);
    const readyCount = nextMasterPlans.length - blocked.length;
    const allBlockers = [...new Set(blocked.flatMap(plan => plan.preproduction?.readiness.blockers || []))];
    return {
      ...input.pack,
      detailGeneration: {
        status: readyCount > 0 && readyCount === masterPlans.length ? 'ready' : 'blocked', startedAt: generatedAt, generatedAt,
        estimatedMinutes: Math.max(2, Math.ceil(masterPlans.length / 2) * 2), usageCostCny: null,
        readyCount, blockedCount: blocked.length, blockers: allBlockers,
      },
      tasks: input.pack.tasks.map(task => task.templateId === 'production' ? { ...task, videoPlans: nextPlans } : task),
    };
  }

  async function prepareContentBatchPlan(input: { tenantId: string; goal: GoalRecord; run: RunRecord; task: TaskRecord; plan: PlanRecord | null; config: DigitalEmployeeConfig }) {
    const enterpriseProfile = await ensureFrozenEnterpriseProfileForRun(
      input.tenantId,
      input.plan,
      input.config,
      input.run.started_at,
    );
    const existing = await first<ContentBatchPlanRecord>(COLLECTION.contentBatchPlans, { tenant_id: input.tenantId, task_id: input.task.id });
    if (existing?.status === 'planned') {
      const routing = jsonObject<{ blocker?: string; eligibleRoutes?: ContentBatchPlanDraft['eligibleRoutes']; disabledRoutes?: ContentBatchPlanDraft['disabledRoutes'] }>(existing.routing, {});
      const draft: ContentBatchPlanDraft = {
        status: existing.status === 'planned' ? 'planned' : 'blocked',
        orders: jsonObject(existing.orders, []),
        coverage: contentPlanCoverage(input.config, goalInput(input.goal), jsonObject<any[]>(existing.orders, []).length),
        blocker: String(routing.blocker || ''),
        eligibleRoutes: routing.eligibleRoutes || [],
        disabledRoutes: routing.disabledRoutes || [],
      };
      return { existing, draft, planBody: jsonObject<Record<string, unknown>>(input.plan?.plan, {}), enterpriseProfile };
    }
    const planBody = jsonObject<Record<string, unknown>>(input.plan?.plan, {});
    const knowledgeBinding = jsonObject<Record<string, unknown>>(planBody.knowledgeBinding, {});
    const priorReview = await first<StoredRecord & { tenant_id: string; summary: unknown }>(COLLECTION.reviews, { tenant_id: input.tenantId }, '-created_at');
    const priorRoutingEvidence = jsonObject<Record<string, unknown>>(jsonObject<Record<string, unknown>>(priorReview?.summary, {}).routingEvidence, {});
    const draft = buildContentBatchPlan({
      goalId: input.goal.id,
      goal: goalInput(input.goal),
      config: input.config,
      evidence: await contentRoutingEvidence(input.tenantId, input.config, enterpriseProfile),
      versions: {
        configVersion: Number(planBody.configVersion || 1),
        policyVersion: String(planBody.policyVersion || 'unknown'),
        factsVersion: String(knowledgeBinding.factsVersion || 'unknown'),
      },
      priorRoutingEvidence: {
        priorRouteDistribution: jsonObject(priorRoutingEvidence.priorRouteDistribution, {}),
        approvalFeedback: jsonObject(priorRoutingEvidence.approvalFeedback, []),
        contentInheritance: jsonObject(priorRoutingEvidence.contentInheritance, {}),
        tagAdaptation: jsonObject(priorRoutingEvidence.tagAdaptation, {}),
        industryTrends: jsonObject(priorRoutingEvidence.industryTrends, {}),
      },
    });
    return { existing, draft, planBody, enterpriseProfile };
  }

  async function ensureContentBatchPlan(input: { tenantId: string; goal: GoalRecord; run: RunRecord; task: TaskRecord; plan: PlanRecord | null; config: DigitalEmployeeConfig }, prepared: Awaited<ReturnType<typeof prepareContentBatchPlan>>) {
    const { existing, draft, planBody } = prepared;
    const knowledgeBinding = jsonObject<Record<string, unknown>>(planBody.knowledgeBinding, {});
    if (existing?.status === 'planned') return { record: existing, created: false, draft };
    const now = new Date().toISOString();
    const pack = planBody.businessPackage as WeeklyPackage | undefined;
    const director = pack?.directorPlan;
    const plans = pack?.tasks.find(item => item.templateId === 'production')?.videoPlans || [];
    const protectedBudget = director?.productionBudgetMode !== 'economy';
    const selectedContentCap = (plan: VideoCreationPlan) => Number(protectedBudget
      ? plan.estimatedCostRange?.maxCny || plan.estimatedCost
      : plan.estimatedCostRange?.minCny || plan.estimatedCost);
    const reservedTotal = plans.reduce((sum, plan) => sum + selectedContentCap(plan), 0);
    if (director && director.productionSpent + reservedTotal > director.productionBudget + 0.000001) throw new Error('已选开工方案的授权上限超过生产预算，请在开工前重新核对');
    const constrainedOrders = draft.orders.map(order => ({ ...order,
      constraints: [...new Set([...(order.constraints || []), ...(director?.qualityStandard ? [`编导确认的脚本与审片标准：${director.qualityStandard}`] : [])])],
      ...(director ? { operatingContext: {
        productionBudget: director.productionBudget,
        productionBudgetMax: director.productionBudget,
        productionSpent: director.productionSpent,
        productionReserved: reservedTotal,
        estimatedContentCost: Number(order.videoPlan?.estimatedCost || 0),
        estimatedContentCostMax: order.videoPlan ? selectedContentCap(order.videoPlan) : 0,
        productionBudgetMode: director.productionBudgetMode,
        maxAigcRetries: protectedBudget ? 1 : 0,
        budgetApprovedAt: String(planBody.packageApprovedAt || ''),
        originalTarget: director.originalTarget,
        platformVersionTarget: director.platformVersionTarget,
        publishTarget: director.publishTarget,
        qualityStandard: director.qualityStandard,
        packageRevision: Number(pack?.revision || 0),
      } } : {}),
    }));
    let effectiveDraft = draft;
    if (draft.status === 'planned') {
      const scriptableOrders = constrainedOrders.filter(order => !order.readinessBlockers?.length);
      const directedOrders = scriptableOrders.length
        ? await generateDirectorScriptContracts({ tenantId: input.tenantId, config: input.config, goal: goalInput(input.goal), orders: scriptableOrders, now, enterpriseProfile: prepared.enterpriseProfile })
        : [];
      const directedById = new Map(directedOrders.map(order => [order.id, order]));
      // Keep every frozen order in the batch. An input gap becomes one blocked
      // content item instead of erasing the other masters from this week.
      effectiveDraft = { ...draft, orders: constrainedOrders.map(order => {
        const directed = directedById.get(order.id);
        return directed ? {
          ...order,
          contractVersion: directed.contractVersion,
          scripts: directed.scripts,
        } satisfies ContentOrder : order;
      }) };
    }
    if (director && input.plan && director.productionReserved !== reservedTotal) {
      const nextPack = { ...pack!, directorPlan: { ...director, productionReserved: reservedTotal } };
      await store.update(COLLECTION.plans, input.plan.id, { plan: { ...planBody, businessPackage: nextPack } });
    }
    if (existing) {
      const patch = { status: effectiveDraft.status, orders: effectiveDraft.orders, routing: { blocker: effectiveDraft.blocker, coverage: effectiveDraft.coverage, eligibleRoutes: effectiveDraft.eligibleRoutes, disabledRoutes: effectiveDraft.disabledRoutes }, updated_at: now };
      await store.update(COLLECTION.contentBatchPlans, existing.id, patch);
      return { record: { ...existing, ...patch }, created: false, draft: effectiveDraft };
    }
    const record = await requiredCreate<ContentBatchPlanRecord>(COLLECTION.contentBatchPlans, {
      tenant_id: input.tenantId, goal_id: input.goal.id, plan_id: input.run.plan_id, run_id: input.run.id, task_id: input.task.id,
      status: effectiveDraft.status, orders: effectiveDraft.orders, routing: { blocker: effectiveDraft.blocker, coverage: effectiveDraft.coverage, eligibleRoutes: effectiveDraft.eligibleRoutes, disabledRoutes: effectiveDraft.disabledRoutes },
      config_version: Number(planBody.configVersion || 1), policy_version: String(planBody.policyVersion || 'unknown'), facts_version: String(knowledgeBinding.factsVersion || 'unknown'),
      created_at: now, updated_at: now,
    });
    return { record, created: true, draft: effectiveDraft };
  }

  return { collectionLimitForInventoryGap, sourceCollectionFailureReason, generateWeeklyTaskPreviews, prepareContentBatchPlan, ensureContentBatchPlan };
}
