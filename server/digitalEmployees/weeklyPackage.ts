import { normalizeTodo } from '../../src/lib/reviewTodos.js';
import { normalizeAssessment, maturityProfiles, taskGuidance } from '../../shared/contracts/operatingMaturity.js';
import { normalizeVideoPlan, videoSchedulingErrors } from '../../shared/contracts/videoCreationPlan.js';
import { defaultMatrixPlan, fillMatrixVideos, linkMatrixVersionsToMasters, normalizeMatrixPlan, matrixScopeIssues } from '../../src/lib/weeklyMatrix.js';
import { LEGACY_TASK_TEMPLATE_IDS, TASK_TEMPLATES, packageIssues, type WeeklyPackage, type PackageTask, type TemplateId, type WeeklyOperatingContext } from '../../src/lib/weeklyPackage.js';
import { defaultDirectorPlan, normalizeDirectorPlan } from '../../src/lib/contentDirector.js';
import { connectedAccountIssues } from '../../shared/contracts/socialOperatingProfile.js';
import { MASTER_VIDEO_COST_MAX_CNY, MASTER_VIDEO_COST_MIN_CNY, MASTER_VIDEO_COST_POINT_CNY } from '../../shared/contracts/contentCostModel.js';
import { estimateWeeklyMixedProduction, type WeeklyMixedContentSlot } from '../../shared/contracts/weeklyMixedContentPlan.js';
import { mixedWeeklyRecommendation } from './weeklyMixedContentPackage.js';
import { buildWeeklyPlan, type DigitalEmployeeConfig, type WeeklyGoalInput, type WeeklyPlanDraft } from './domain.js';
import { scheduleWeeklyVideos } from '../../src/lib/weeklyGoalSchedule.js';
import { DEFAULT_FACEBOOK_PROMOTION_CNY } from '../../src/lib/defaultFacebookPromotion.js';

const splitMarkets = (value: string): string[] => [...new Set(value.split(/[、，,；;\n]/).map(item => item.trim()).filter(Boolean))];

export function buildWeeklyOperatingContext(
  pack: WeeklyPackage,
  goal: WeeklyGoalInput,
  config: DigitalEmployeeConfig,
): WeeklyOperatingContext {
  const videos = pack.tasks.find(task => task.templateId === 'production')?.videoPlans || [];
  const mixed = pack.mixedContentSlots;
  const masters = videos.filter(video => video.productionRole !== 'platform_adaptation');
  const rows = pack.matrixPlan || [];
  const imageQuote = mixed ? estimateWeeklyMixedProduction(mixed) : null;
  const imageMin = imageQuote ? imageQuote.minCny - imageQuote.videoOriginals * imageQuote.unitVideoMinCny : 0;
  const imageMax = imageQuote ? imageQuote.maxCny - imageQuote.videoOriginals * imageQuote.unitVideoMaxCny : 0;
  const plannedPoint = masters.reduce((sum, video) => sum + Math.max(0, Number(video.estimatedCost) || 0), 0) + imageMax;
  const plannedMin = Math.max(masters.reduce((sum, video) => sum + Math.max(0, Number(video.estimatedCostRange?.minCny) || 0), 0),
    mixed ? masters.length * (imageQuote?.unitVideoMinCny || 0) : 0) + imageMin;
  const plannedMax = Math.max(masters.reduce((sum, video) => sum + Math.max(0, Number(video.estimatedCostRange?.maxCny) || 0), 0),
    mixed ? masters.length * (imageQuote?.unitVideoMaxCny || 0) : 0) + imageMax;
  const productionCny = Number(pack.directorPlan?.productionBudget || 0) || plannedPoint;
  const productionMinCny = plannedMin || Number(pack.directorPlan?.productionBudgetMin || 0);
  const productionMaxCny = plannedMax || Number(pack.directorPlan?.productionBudgetMax || pack.directorPlan?.productionBudget || 0);
  const paidMediaCny = Number(pack.directorPlan?.paidMediaBudget || 0);
  const accountWeights = rows.map(row => ({ accountId: row.accountId, platform: row.platform,
    weight: mixed ? mixed.filter(slot => slot.accountId === row.accountId && slot.productionRole === 'original').length
      : Math.max(1, row.weeklyCount) }));
  const totalWeight = Math.max(1, accountWeights.reduce((sum, item) => sum + item.weight, 0));
  const accounts = rows.map(row => {
    const connected = config.publishingTargets.find(target => target.accountId === row.accountId && target.platform === row.platform);
    const allocation = accountWeights.find(item => item.accountId === row.accountId && item.platform === row.platform)!;
    return {
      accountId: row.accountId,
      platform: row.platform,
      accountLabel: connected?.accountLabel || row.accountId,
      positioning: row.contentDirection || row.objective || row.accountRole || '本周内容账号',
      contentCount: row.weeklyCount,
      budgetCny: productionCny > 0 ? Math.round((productionCny * allocation.weight / totalWeight) * 100) / 100 : null,
      allocationBasis: 'content_load' as const,
    };
  });
  const formats = mixed ? ['短视频', '产品单图'] : [...new Set(videos.map(video => video.route === 'clone' ? '爆款复刻短视频' : video.route === 'material' ? '素材加工短视频' : '产品短视频'))];
  return {
    objective: goal.objective,
    metric: `${goal.metric}：${goal.baseline} → ${goal.target} ${goal.unit}`,
    markets: splitMarkets(config.targetMarkets),
    cycle: { startsAt: goal.startsAt, endsAt: goal.endsAt },
    accounts,
    budget: {
      currency: pack.directorPlan?.currency || 'CNY',
      productionCny,
      productionMinCny,
      productionMaxCny,
      paidMediaCny,
      totalCny: Math.round((productionCny + paidMediaCny) * 100) / 100,
      totalMinCny: Math.round((productionMinCny + paidMediaCny) * 100) / 100,
      totalMaxCny: Math.round((productionMaxCny + paidMediaCny) * 100) / 100,
    },
    promotionPlans: goal.promotionPlans || [],
    cadence: {
      contentCount: mixed?.length || videos.length || rows.reduce((sum, row) => sum + row.weeklyCount, 0),
      description: mixed ? '15 条发布内容 / 周，10 条独立制作（6 视频、4 单图）' : config.socialCadence || `${videos.length} 条 / 周`,
      reviewSchedule: config.reviewSchedule,
    },
    authorization: {
      mode: pack.authorization.mode,
      allowRealPublishing: config.allowRealPublishing,
      allowRealCustomerMessages: config.allowRealCustomerMessages,
      accountIds: [...pack.authorization.accountIds],
      maxPublishItems: pack.authorization.maxPublishItems,
      maxCustomerMessages: pack.authorization.maxCustomerMessages,
    },
    outputs: {
      count: mixed?.length || videos.length || rows.reduce((sum, row) => sum + row.weeklyCount, 0),
      originalCount: mixed ? mixed.filter(slot => slot.productionRole === 'original').length : masters.length,
      platformVersionCount: mixed?.length || videos.length,
      publishCount: rows.reduce((sum, row) => sum + row.weeklyCount, 0) || videos.length,
      formats: formats.length ? formats : ['短视频'],
      totalDurationSeconds: masters.reduce((sum, video) => sum + Math.max(0, Number(video.duration) || 0), 0),
    },
  };
}

export function recommendPackage(goal: WeeklyGoalInput, config: DigitalEmployeeConfig, ownerId = '', ownerName = ''): WeeklyPackage {
  const base = buildWeeklyPlan(goal, config);
  const mixedRecommendation = mixedWeeklyRecommendation({ goal, config });
  const maturity = config.operatingMaturity || 'growing';
  const participation = config.defaultParticipation || 'agent';
  const keys = new Set(base.tasks.map(t => t.key));
  const tasks = TASK_TEMPLATES.filter(t => t.keys.some(key => keys.has(key)) && (maturity !== 'starting' || ['readiness', 'director', 'production', 'publishing', 'customers', 'followup', 'review'].includes(t.id))).map(template => ({
    templateId: template.id, title: template.title,
    ownerId: participation === 'team' && !['review'].includes(template.id) ? ownerId : '',
    ownerName: participation === 'team' && ownerId ? ownerName : '', dueAt: goal.endsAt, notes: taskGuidance(maturity, template.id, config.operatingAssessment), sourceProjectIds: [],
    ...(template.id === 'production' ? { videoPlans: mixedRecommendation ? [] : goal.videoPlans?.length ? goal.videoPlans : [normalizeVideoPlan({ ...config.videoDefaults, productName: config.focusProducts.split(/[、，,；;]/)[0], theme: '介绍产品的用途与特点', platform: goal.contentPlatforms[0] })] } : {}),
  }));
  const matrixPlan = goal.businessLine === 'customer_conversion' ? [] : mixedRecommendation?.rows || defaultMatrixPlan(config, goal.contentPlatforms, goal.objective);
  const baseContentCount = tasks.find(t => t.templateId === 'production')?.videoPlans?.length || 0;
  const platformVersionTarget = mixedRecommendation?.slots.filter(slot => slot.kind === 'video' && slot.productionRole === 'original').length
    || matrixPlan.reduce((sum, row) => sum + row.weeklyCount, 0) || baseContentCount;
  // One planned video is one independently generated and charged deliverable.
  // Cross-platform reuse must never reduce the actual production quantity.
  const originalTarget = platformVersionTarget;
  const initialDirectorPlan = defaultDirectorPlan(originalTarget, platformVersionTarget, platformVersionTarget);
  const imageQuote = mixedRecommendation ? estimateWeeklyMixedProduction(mixedRecommendation.slots) : null;
  const imageMin = imageQuote ? imageQuote.minCny - originalTarget * imageQuote.unitVideoMinCny : 0;
  const imageMax = imageQuote ? imageQuote.maxCny - originalTarget * imageQuote.unitVideoMaxCny : 0;
  initialDirectorPlan.productionBudgetMin = imageQuote ? imageQuote.minCny : originalTarget * MASTER_VIDEO_COST_MIN_CNY + imageMin;
  // This is a public-price planning estimate, not user paid-call authority.
  initialDirectorPlan.productionBudget = imageQuote ? imageQuote.maxCny : originalTarget * MASTER_VIDEO_COST_MAX_CNY + imageMax;
  initialDirectorPlan.productionBudgetMax = initialDirectorPlan.productionBudget;
  initialDirectorPlan.paidMediaBudget = Math.round(((goal.promotionPlans?.length
    ? goal.promotionPlans.reduce((sum, item) => sum + item.budgetCny, 0)
    : mixedRecommendation ? mixedRecommendation.slots.filter(slot => slot.platform === 'facebook').length * DEFAULT_FACEBOOK_PROMOTION_CNY : 0)) * 100) / 100;
  let recommended: WeeklyPackage = { revision: 1, referenceSourcePolicy: 'existing_library_only',
    ...(mixedRecommendation ? { mixedContentSlots: mixedRecommendation.slots } : {}),
    maturity, operatingAssessment: normalizeAssessment(config.operatingAssessment), participation, tasks,
    ...(matrixPlan.length ? { matrixPlan } : {}),
    directorPlan: initialDirectorPlan,
    // Approving the weekly package is the single human authorization event.
    // Every actual publish still has to pass the frozen account/week/count/hash
    // boundary and the existing quality, connection and receipt safeguards.
    authorization: { mode: 'bounded', accountIds: config.publishingTargets.map(t => t.accountId), maxPublishItems: 1, customerIds: [], maxCustomerMessages: 1 } };
  if (matrixPlan.length) recommended = fillMatrixVideos(recommended, config.videoDefaults || {}, goal.endsAt);
  const contentCount = recommended.tasks.find(t => t.templateId === 'production')?.videoPlans?.length || 0;
  const defaultPublishActions = matrixPlan.length
    ? matrixPlan.reduce((sum, row) => sum + row.weeklyCount, 0)
    : contentCount * Math.max(1, config.publishingTargets.filter(target => goal.contentPlatforms.includes(target.platform)).length);
  const result: WeeklyPackage = {
    ...recommended,
    directorPlan: { ...initialDirectorPlan, platformVersionTarget: contentCount, publishTarget: defaultPublishActions },
    authorization: { ...recommended.authorization, maxPublishItems: Math.max(1, defaultPublishActions) },
  };
  return { ...result, operatingContext: buildWeeklyOperatingContext(result, goal, config) };
}

export function normalizePackage(raw: WeeklyPackage): WeeklyPackage {
  if (!raw || !Array.isArray(raw.tasks) || raw.tasks.length > TASK_TEMPLATES.length + LEGACY_TASK_TEMPLATE_IDS.length) throw Error('任务包格式无效');
  const clean = (s: unknown, max = 500) => String(s || '').trim().slice(0, max);
  const ids = (x: unknown) => Array.isArray(x) ? [...new Set(x.map(v => clean(v, 160)).filter(Boolean))].slice(0, 100) : [];
  const activeIds = new Set<string>(TASK_TEMPLATES.map(template => template.id));
  const legacyIds = new Set<string>(LEGACY_TASK_TEMPLATE_IDS);
  const sourceTasks = raw.tasks as Array<PackageTask & { templateId: string }>;
  if (sourceTasks.some(task => !activeIds.has(task.templateId) && !legacyIds.has(task.templateId))) throw Error('任务包包含不支持的任务模板');
  const legacyTasks = sourceTasks.filter(task => legacyIds.has(task.templateId));
  const currentTasks = sourceTasks.filter(task => !legacyIds.has(task.templateId));
  if (legacyTasks.length) {
    const currentDirector = currentTasks.find(task => task.templateId === 'director');
    const mergedNotes = [...new Set([currentDirector?.notes, ...legacyTasks.map(task => task.notes)].map(note => clean(note, 1000)).filter(Boolean))].join('\n').slice(0, 1000);
    const mergedSources = ids([...(currentDirector?.sourceProjectIds || []), ...legacyTasks.flatMap(task => task.sourceProjectIds || [])]);
    const base = currentDirector || legacyTasks[0];
    const migrated: PackageTask = {
      templateId: 'director', title: currentDirector?.title || '分析爆款并完成脚本分镜', ownerId: clean(base.ownerId, 160), ownerName: clean(base.ownerName, 160),
      dueAt: clean(base.dueAt, 10), notes: mergedNotes, sourceProjectIds: mergedSources,
    };
    const index = currentTasks.findIndex(task => task.templateId === 'director');
    if (index >= 0) currentTasks[index] = migrated;
    else currentTasks.push(migrated);
  }
  const a = raw.authorization;
  const detail = raw.detailGeneration;
  const normalized: WeeklyPackage = {
    ...(raw.referenceSourcePolicy === 'existing_library_only' ? { referenceSourcePolicy: 'existing_library_only' as const } : {}),
    ...(Array.isArray(raw.mixedContentSlots) ? { mixedContentSlots: raw.mixedContentSlots.slice(0, 30).map(slot => ({
      slotId: clean(slot.slotId, 120), accountId: clean(slot.accountId, 160),
      platform: slot.platform === 'linkedin' ? 'linkedin' as const : 'facebook' as const,
      kind: slot.kind === 'image' ? 'image' as const : 'video' as const,
      presentation: slot.presentation === 'image' ? 'image' as const : 'video' as const,
      productionRole: slot.productionRole === 'adaptation' ? 'adaptation' as const : 'original' as const,
      originalSlotId: clean(slot.originalSlotId, 120),
      ...(slot.kind === 'image' && slot.productionRole === 'original' && clean(slot.referenceId, 160)
        ? { referenceId: clean(slot.referenceId, 160), referenceTitle: clean(slot.referenceTitle, 500),
          referenceSourceUrl: clean(slot.referenceSourceUrl, 2_000) } : {}),
    } satisfies WeeklyMixedContentSlot)) } : {}),
    ...(raw.directorPlan !== undefined ? { directorPlan: normalizeDirectorPlan(raw.directorPlan) } : {}),
    ...(raw.matrixPlan !== undefined ? { matrixPlan: normalizeMatrixPlan(raw.matrixPlan) } : {}),
    ...(Array.isArray(raw.reviewTodos) ? { reviewTodos: raw.reviewTodos.slice(0, 50).map(t => normalizeTodo(t)) } : {}),
    ...(detail && ['generating', 'ready', 'blocked'].includes(String(detail.status)) ? { detailGeneration: {
      status: detail.status,
      startedAt: clean(detail.startedAt, 80),
      generatedAt: clean(detail.generatedAt, 80),
      estimatedMinutes: Math.max(1, Math.min(120, Math.floor(Number(detail.estimatedMinutes) || 1))),
      usageCostCny: detail.usageCostCny !== null
        && detail.usageCostCny !== undefined
        && Number.isFinite(Number(detail.usageCostCny))
        && Number(detail.usageCostCny) >= 0
        ? Math.round(Number(detail.usageCostCny) * 10_000) / 10_000
        : null,
      readyCount: Math.max(0, Math.min(30, Math.floor(Number(detail.readyCount) || 0))),
      blockedCount: Math.max(0, Math.min(30, Math.floor(Number(detail.blockedCount) || 0))),
      blockers: Array.isArray(detail.blockers) ? [...new Set(detail.blockers.map(item => clean(item, 500)).filter(Boolean))].slice(0, 30) : [],
    } } : {}),
    revision: Number.isInteger(raw.revision) ? raw.revision : 0,
    maturity: ['starting', 'growing', 'established'].includes(raw.maturity) ? raw.maturity : 'growing',
    operatingAssessment: normalizeAssessment(raw.operatingAssessment),
    participation: raw.participation === 'team' ? 'team' : 'agent',
    tasks: currentTasks.map(t => ({ templateId: t.templateId as TemplateId, title: clean(t.title, 160), ownerId: clean(t.ownerId, 160), ownerName: clean(t.ownerName, 160), dueAt: clean(t.dueAt, 10), notes: clean(t.notes, 1000), sourceProjectIds: ids(t.sourceProjectIds), ...(t.templateId === 'production' ? { videoPlans: (t.videoPlans || []).slice(0, 30).map(normalizeVideoPlan) } : {}) })),
    authorization: { mode: a?.mode === 'bounded' ? 'bounded' : 'each', accountIds: ids(a?.accountIds), customerIds: ids(a?.customerIds), maxPublishItems: Math.min(100, Math.max(0, Math.floor(Number(a?.maxPublishItems) || 0))), maxCustomerMessages: Math.min(100, Math.max(0, Math.floor(Number(a?.maxCustomerMessages) || 0))) },
  };
  return repairCollapsedWeeklyVideoProduction(normalized);
}

/**
 * Repairs the historic cross-platform slot collision without adding, removing,
 * or renaming any planned video. The migration is deliberately narrow: it only
 * applies when the saved director target already says every planned video must
 * be independently produced.
 */
export function repairCollapsedWeeklyVideoProduction(pack: WeeklyPackage): WeeklyPackage {
  const production = pack.tasks.find(task => task.templateId === 'production');
  const plans = production?.videoPlans || [];
  const cycle = pack.operatingContext?.cycle;
  if (production && cycle && plans.length && plans.some(plan => !plan.plannedPublishAt)) {
    const scheduledPlans = scheduleWeeklyVideos(plans, cycle.startsAt, cycle.endsAt);
    const scheduleChanged = scheduledPlans.some((plan, index) => (
      plan.plannedPublishDate !== plans[index]?.plannedPublishDate
      || plan.plannedPublishAt !== plans[index]?.plannedPublishAt
    ));
    if (scheduleChanged) {
      return repairCollapsedWeeklyVideoProduction({
        ...pack,
        tasks: pack.tasks.map(task => task === production ? { ...task, videoPlans: scheduledPlans } : task),
      });
    }
  }
  const independentCount = plans.filter(plan => plan.productionRole !== 'platform_adaptation').length;
  // A mixed package has 15 publication slots but only six video plans. The
  // legacy video-only repair must never rewrite its output count or quote.
  if (pack.mixedContentSlots?.length) return pack;
  // Repair only the known historic slot-linking defect: the saved director
  // explicitly requested one independent production per planned video, but
  // plans from different platforms were accidentally collapsed into one
  // family. Historic packages that intentionally requested fewer independent
  // productions keep their lineage unchanged.
  if (pack.directorPlan && plans.length > 0
    && pack.directorPlan.originalTarget === plans.length) {
    // Some drafts were already relinked by the matrix synchronizer before
    // being persisted, but still retained the old one-video cost envelope.
    // Canonicalize both lineage and cost here so every read/start path sees
    // the same number of independently produced videos and the same budget.
    const relinkedPlans = independentCount === plans.length
      ? plans
      : linkMatrixVersionsToMasters(plans, plans.length);
    const repairedPlans = relinkedPlans.map(plan => normalizeVideoPlan({
      ...plan,
      estimatedCost: Math.max(Number(plan.estimatedCost || 0), MASTER_VIDEO_COST_POINT_CNY),
      estimatedCostRange: {
        minCny: Math.max(Number(plan.estimatedCostRange?.minCny || 0), MASTER_VIDEO_COST_MIN_CNY),
        maxCny: Math.max(Number(plan.estimatedCostRange?.maxCny || 0), MASTER_VIDEO_COST_MAX_CNY),
        basis: plan.estimatedCostRange?.basis || 'blended_master',
      },
    }));
    const repairedDirector = {
      ...pack.directorPlan,
      originalTarget: repairedPlans.length,
      platformVersionTarget: repairedPlans.length,
      productionBudgetMin: Math.max(pack.directorPlan.productionBudgetMin, repairedPlans.length * MASTER_VIDEO_COST_MIN_CNY),
      productionBudget: pack.directorPlan.productionBudgetMode === 'economy'
        ? Math.max(pack.directorPlan.productionBudgetMin, repairedPlans.length * MASTER_VIDEO_COST_MIN_CNY)
        : Math.max(pack.directorPlan.productionBudgetMax, repairedPlans.length * MASTER_VIDEO_COST_MAX_CNY),
      productionBudgetMax: Math.max(pack.directorPlan.productionBudgetMax, repairedPlans.length * MASTER_VIDEO_COST_MAX_CNY),
    };
    const paidMediaCny = Number(pack.operatingContext?.budget.paidMediaCny || repairedDirector.paidMediaBudget || 0);
    const accountWeight = Math.max(1, pack.operatingContext?.accounts.reduce((sum, account) => sum + Math.max(1, account.contentCount), 0) || 1);
    const operatingContext = pack.operatingContext ? {
      ...pack.operatingContext,
      accounts: pack.operatingContext.accounts.map(account => ({
        ...account,
        budgetCny: Math.round((repairedDirector.productionBudget * Math.max(1, account.contentCount) / accountWeight) * 100) / 100,
      })),
      budget: {
        ...pack.operatingContext.budget,
        productionCny: repairedDirector.productionBudget,
        productionMinCny: repairedDirector.productionBudgetMin,
        productionMaxCny: repairedDirector.productionBudgetMax,
        totalCny: Math.round((repairedDirector.productionBudget + paidMediaCny) * 100) / 100,
        totalMinCny: Math.round((repairedDirector.productionBudgetMin + paidMediaCny) * 100) / 100,
        totalMaxCny: Math.round((repairedDirector.productionBudgetMax + paidMediaCny) * 100) / 100,
      },
      outputs: {
        ...pack.operatingContext.outputs,
        count: repairedPlans.length,
        originalCount: repairedPlans.length,
        platformVersionCount: repairedPlans.length,
      },
    } : undefined;
    const plansChanged = independentCount !== plans.length
      || plans.some(plan => Number(plan.estimatedCost || 0) < MASTER_VIDEO_COST_POINT_CNY
        || Number(plan.estimatedCostRange?.minCny || 0) < MASTER_VIDEO_COST_MIN_CNY
        || Number(plan.estimatedCostRange?.maxCny || 0) < MASTER_VIDEO_COST_MAX_CNY);
    const budgetChanged = pack.directorPlan.platformVersionTarget !== repairedPlans.length
      || pack.directorPlan.productionBudgetMin < repairedPlans.length * MASTER_VIDEO_COST_MIN_CNY
      || pack.directorPlan.productionBudget < repairedPlans.length * MASTER_VIDEO_COST_POINT_CNY
      || pack.directorPlan.productionBudgetMax < repairedPlans.length * MASTER_VIDEO_COST_MAX_CNY
      || Boolean(pack.operatingContext && (
        Number(pack.operatingContext.budget.productionMinCny || 0) < repairedDirector.productionBudgetMin
        || Number(pack.operatingContext.budget.productionCny || 0) < repairedDirector.productionBudget
        || Number(pack.operatingContext.budget.productionMaxCny || 0) < repairedDirector.productionBudgetMax
        || pack.operatingContext.outputs.count !== repairedPlans.length
      ));
    if (!plansChanged && !budgetChanged) return pack;
    return {
      ...pack,
      tasks: pack.tasks.map(task => task === production ? { ...task, videoPlans: repairedPlans } : task),
      directorPlan: repairedDirector,
      ...(operatingContext ? { operatingContext } : {}),
    };
  }
  return pack;
}

export function validatePackage(pack: WeeklyPackage, goal: WeeklyGoalInput, config?: DigitalEmployeeConfig): string[] {
  const videoPlans = pack.tasks.find(task => task.templateId === 'production')?.videoPlans || [];
  const plannedVersions = config ? videoPlans.reduce((sum, plan) => sum + (plan.matrix ? 1 : Math.max(1, config.videoLanguages?.length || 1)), 0) : 0;
  const versionIssues = config && pack.directorPlan && plannedVersions !== pack.directorPlan.platformVersionTarget
    ? [`编导目标为 ${pack.directorPlan.platformVersionTarget} 个平台版本，但当前语言与账号计划将生成 ${plannedVersions} 个版本`]
    : [];
  const growthIssues = config?.socialOperatingProfile === 'dual_account_growth'
    ? [
        ...(config.operatingMaturity === 'established' ? [] : ['双账号增长方案只能在经营成熟度达到稳定经营后启动']),
        ...connectedAccountIssues('dual_account_growth', config.publishingTargets),
        ...(pack.tasks.some(task => task.templateId === 'publishing') && !pack.matrixPlan?.length ? ['双账号增长发布前必须配置逐账号矩阵，禁止把同一成片无差别广播到全部账号'] : []),
        ...(pack.matrixPlan?.some(row => row.platform === 'tiktok' || row.platform === 'facebook')
          ? ['tiktok', 'facebook'].flatMap(platform => {
              const roles = new Set(pack.matrixPlan!.filter(row => row.platform === platform).map(row => row.accountRole || 'brand_combined'));
              return roles.has('brand_capability') && roles.has('buyer_advisor') ? [] : [`${platform} 双账号需要分别标记“品牌能力号”和“买家顾问号”`];
            })
          : []),
      ]
    : [];
  return [...packageIssues(pack, goal.startsAt, goal.endsAt), ...versionIssues, ...growthIssues, ...(config ? matrixScopeIssues(pack, config.publishingTargets, goal.contentPlatforms) : []), ...pack.tasks.flatMap(t => (t.videoPlans || []).flatMap((p, i) => videoSchedulingErrors(p)
    .map(e => `第 ${i + 1} 条视频：${e}`)))];
}

/**
 * Admission validation for starting an operating run. It keeps the package,
 * tenant-owned strategy boundaries, while deferring per-video
 * inputs and real publishing-account authorization to the affected runtime
 * task. `validatePackage` remains the strict editor/review validator.
 */
export function validatePackageForStart(pack: WeeklyPackage, goal: WeeklyGoalInput, config?: DigitalEmployeeConfig): string[] {
  const deferredPublishingIssues = new Set([
    '发布内容需要制作任务，或选择已有作品',
    '已连接矩阵账号不在本周允许发布的账号范围内',
    '矩阵账号必须属于本计划及本周平台范围',
    '发布次数目标不能少于平台交付版本目标',
    '已有作品的账号安排与发布任务不一致，请同步视频计划',
    '请安排至少一个矩阵账号，或移除本周发布任务',
    '双账号增长发布前必须配置逐账号矩阵，禁止把同一成片无差别广播到全部账号',
    '请选择有效的矩阵账号',
  ]);
  const strictIssues = validatePackage(pack, goal, config).filter(issue => {
    if (/^第 \d+ 条视频：/.test(issue)) return false;
    if (/^(?:youtube|tiktok|instagram|facebook) 需要 \d+ 个账号，当前已接入 \d+ 个$/.test(issue)) return false;
    return !deferredPublishingIssues.has(issue);
  });
  const validPlatforms = new Set(goal.contentPlatforms);
  if (pack.matrixPlan?.some(row => !['facebook', 'instagram', 'tiktok', 'youtube', 'linkedin'].includes(row.platform) || !validPlatforms.has(row.platform))) {
    strictIssues.push('矩阵制作平台必须属于本周目标范围');
  }
  return [...new Set(strictIssues)];
}

export function packageConfig(pack: WeeklyPackage, config: DigitalEmployeeConfig): DigitalEmployeeConfig {
  const selected = new Set(pack.tasks.map(t => t.templateId));
  const workflows: DigitalEmployeeConfig['enabledWorkflows'] = [];
  if (selected.has('director')) workflows.push('scheduled_social', 'viral_clone');
  // Content Agent production is admitted only through the Director's viral
  // replication workflow. Free creation is an independent human workflow.
  if (selected.has('publishing')) workflows.push('content_publish');
  if (selected.has('customers')) workflows.push('customer_segmentation');
  if (selected.has('followup')) workflows.push('batch_followup');
  return { ...config, enabledWorkflows: workflows, publishingTargets: config.publishingTargets.filter(t => pack.authorization.accountIds.includes(t.accountId) && (!pack.matrixPlan || pack.matrixPlan.some(row => row.accountId === t.accountId))) };
}

export function compilePackage(pack: WeeklyPackage, goal: WeeklyGoalInput, config: DigitalEmployeeConfig): WeeklyPlanDraft & { businessPackage: WeeklyPackage } {
  const selected = new Set(pack.tasks.map(t => t.templateId));
  const base = buildWeeklyPlan({ ...goal, businessLine: 'full_funnel' }, packageConfig(pack, config));
  const allowed = new Set<string>(['context_readiness', 'goal_decomposition']);
  for (const t of TASK_TEMPLATES.filter(t => selected.has(t.id))) for (const key of t.keys) allowed.add(key);
  const tasks = base.tasks.filter(t => allowed.has(t.key));
  const included = new Set(tasks.map(t => t.key));
  for (const todo of pack.reviewTodos || []) {
    if (todo.kind === 'video') continue;
    tasks.push({ key: `review_todo_${todo.id}`, title: todo.title,
      description: `来源洞察：${todo.sourceTitle}\n执行要求：${todo.requirements}\n参考依据：${todo.reference}\n所需资料：${todo.materials}\n验收条件：${todo.acceptance}`,
      agentRole: todo.kind === 'followup' ? 'customer' : 'business', kind: 'planning', sequence: tasks.length + 1, priority: 'high', requiresApproval: false, dependsOn: [], expectedMinutes: 10,
      businessDomain: todo.kind === 'followup' ? 'customer' : 'foundation', capabilityKey: 'review.todo',
      destination: todo.kind === 'knowledge' ? 'enterprise' : todo.kind === 'followup' ? 'conversion' : 'digitalEmployees', statusSource: '人工完成确认及业务记录', executionMode: 'observe', externalEffect: 'none', automaticExecutionAllowed: false, policySource: 'effective_runtime_policy' });
  }
  const review = tasks.find(t => t.key === 'weekly_review');
  for (const task of tasks.filter(t => t.key.startsWith('review_todo_'))) { included.add(task.key); if (review) review.dependsOn = [...new Set([...review.dependsOn, task.key])]; }
  return { ...base, businessPackage: { ...pack, operatingContext: buildWeeklyOperatingContext(pack, goal, config) },
    strategy: maturityProfiles[pack.maturity].strategy,
    successCriteria: [...base.successCriteria, maturityProfiles[pack.maturity].criteria],
    tasks: tasks.map((t, index) => ({ ...t, description: [t.description, packageTaskForKey(pack, t.key)?.notes].filter(Boolean).join('\n本周工作说明：'), sequence: index + 1, dependsOn: t.dependsOn.filter(k => included.has(k)) })),
  };
}
export function packageTaskForKey(pack: WeeklyPackage | undefined, key: string): PackageTask | undefined {
  const template = TASK_TEMPLATES.find(t => (t.keys as readonly string[]).includes(key));
  return pack?.tasks.find(t => t.templateId === template?.id);
}

export function criticalBusinessConfigChanges(before: DigitalEmployeeConfig, after: DigitalEmployeeConfig): string[] {
  const stable = (values: string[]) => JSON.stringify([...new Set(values)].sort());
  const changed: string[] = [];
  if (before.focusProducts !== after.focusProducts) changed.push('products');
  if (before.targetMarkets !== after.targetMarkets) changed.push('markets');
  if (before.customerProfile !== after.customerProfile) changed.push('audience');
  if (stable(before.videoLanguages) !== stable(after.videoLanguages)) changed.push('languages');
  if (stable(before.publishingTargets.map(item => item.platform)) !== stable(after.publishingTargets.map(item => item.platform))) changed.push('platforms');
  const accountScopeChanged = stable(before.publishingTargets.map(item => `${item.platform}:${item.accountId}`)) !== stable(after.publishingTargets.map(item => `${item.platform}:${item.accountId}`));
  if (accountScopeChanged) changed.push('accounts');
  if (!accountScopeChanged && stable(before.publishingTargets.map(item => `${item.platform}:${item.accountId}:${item.weeklyCount ?? 'legacy'}`)) !== stable(after.publishingTargets.map(item => `${item.platform}:${item.accountId}:${item.weeklyCount ?? 'legacy'}`))) changed.push('weeklyPublishingQuota');
  if (before.allowRealPublishing !== after.allowRealPublishing) changed.push('realPublishingPermission');
  return changed;
}

// A package grant authorizes only the frozen scope. A later content edit is
// separately detected by the existing content hash and quality preflight.
export function grantCovers(pack: WeeklyPackage, effect: 'publish' | 'send', ids: string[], count: number, now: string, endsAt: string): boolean {
  const a = pack.authorization;
  if (a.mode !== 'bounded' || now.slice(0, 10) > endsAt || count < 1) return false;
  const scope = effect === 'publish' ? a.accountIds : a.customerIds;
  const limit = effect === 'publish' ? a.maxPublishItems : a.maxCustomerMessages;
  return count <= limit && ids.length > 0 && ids.every(id => scope.includes(id));
}
