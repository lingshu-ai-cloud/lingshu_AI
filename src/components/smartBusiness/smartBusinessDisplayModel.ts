import type { ContentQueueItem, DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import type { DeliveryResource } from '../../lib/delivery';
import type { VideoCreationPlan } from '../../lib/videoCreationPlan';
import { thumbnailUrlWithSourceFallback } from '../../lib/calendarModel';
import { isSmartBusinessShowcaseEnabled, isSmartBusinessWeeklyPlanPreviewEnabled, smartBusinessShowcaseWeeklyVideos, SMART_BUSINESS_SHOWCASE_WEEKLY_TOTALS } from '../../dev/smartBusinessShowcaseData';
import { MASTER_VIDEO_COST_MAX_CNY, MASTER_VIDEO_COST_MIN_CNY, MASTER_VIDEO_COST_POINT_CNY } from '../../../shared/contracts/contentCostModel';

export const platformOptions = ["youtube", "tiktok", "instagram", "facebook", "linkedin"] as const;
export type Platform = (typeof platformOptions)[number];
export const platformLabels: Record<Platform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
};

const DEFAULT_VIDEO_COST_CNY = {
  min: MASTER_VIDEO_COST_MIN_CNY,
  point: MASTER_VIDEO_COST_POINT_CNY,
  max: MASTER_VIDEO_COST_MAX_CNY,
} as const;

export function weeklyVideoBudget(data: DigitalEmployeeOverview) {
  const pack = data.plan?.businessPackage;
  const plans = pack?.tasks.find(task => task.templateId === "production")?.videoPlans || [];
  const everyPlanIsProduction = Boolean(plans.length && pack?.directorPlan?.originalTarget === plans.length);
  const estimated = plans.reduce((sum, plan) => sum + Math.max(
    Number(plan.estimatedCost || 0),
    everyPlanIsProduction ? DEFAULT_VIDEO_COST_CNY.point : 0,
  ), 0);
  const min = plans.reduce((sum, plan) => sum + Math.max(
    Number(plan.estimatedCostRange?.minCny || 0),
    everyPlanIsProduction ? DEFAULT_VIDEO_COST_CNY.min : 0,
  ), 0);
  const max = plans.reduce((sum, plan) => sum + Math.max(
    Number(plan.estimatedCostRange?.maxCny || 0),
    everyPlanIsProduction ? DEFAULT_VIDEO_COST_CNY.max : 0,
  ), 0);
  return { plans, estimated, min, max };
}

const contentTitleEmojis = ["✨", "🧴", "🏭", "🔬", "💡", "📦"];

export function engagingContentTitle(value: string, index: number) {
  const title = value.trim();
  if (!title) return `${contentTitleEmojis[index % contentTitleEmojis.length]} 本周内容 ${index + 1}`;
  return /\p{Extended_Pictographic}/u.test(title) ? title : `${contentTitleEmojis[index % contentTitleEmojis.length]} ${title}`;
}

export type WeeklyInspirationReference = {
  referenceId: string;
  sourceUrl: string;
  title: string;
  platform: Platform;
  thumbnailUrl: string;
  duration: number;
  benchmarkAnalysis?: VideoCreationPlan["benchmarkAnalysis"];
};

function videoPlanFamilyKey(plan: VideoCreationPlan) {
  return plan.contentFamilyId || plan.masterContentId || plan.contentId || "";
}

/** Resolve an adapted publication back to its frozen original before reading reference identity. */
export function referencePlanForPublication(plans: VideoCreationPlan[], plan: VideoCreationPlan) {
  const explicitMaster = plan.masterContentId
    ? plans.find(candidate => candidate.contentId === plan.masterContentId)
    : undefined;
  if (explicitMaster) return explicitMaster;
  const familyKey = videoPlanFamilyKey(plan);
  if (!familyKey) return plan;
  return plans.find(candidate => videoPlanFamilyKey(candidate) === familyKey && candidate.productionRole === "master")
    || plans.find(candidate => videoPlanFamilyKey(candidate) === familyKey)
    || plan;
}

/** Only persisted plan evidence may establish the exact inspiration destination. */
export function inspirationReferenceForPlan(plan: VideoCreationPlan): WeeklyInspirationReference | null {
  const referenceId = String(plan.referenceId || plan.preproduction?.benchmark.referenceId || "").trim();
  const sourceUrl = String(plan.preproduction?.benchmark.sourceUrl || plan.planningEvidence?.referenceSourceUrl || "").trim();
  if (!referenceId && !sourceUrl) return null;
  return {
    referenceId,
    sourceUrl,
    title: String(plan.planningEvidence?.referenceTitle || plan.preproduction?.benchmark.title || plan.theme || "").trim(),
    platform: plan.platform,
    thumbnailUrl: String(plan.preproduction?.benchmark.thumbnailUrl || plan.planningEvidence?.referenceThumbnailUrl || "").trim(),
    duration: Math.max(0, Number(plan.duration || 0)),
    benchmarkAnalysis: plan.benchmarkAnalysis,
  };
}

export function inspirationReferenceNavigationDetail(reference: WeeklyInspirationReference, contentItemId?: string) {
  return {
    page: "socialInspiration" as const,
    view: "inspiration" as const,
    businessRef: { referenceId: reference.referenceId },
    inspirationReference: reference,
    ...(contentItemId ? { contentItemId } : {}),
  };
}

export type DisplayMetricSource = "real" | "demo";

export type UnifiedPlanContent = {
  id: string;
  contentId: string;
  familyId: string;
  title: string;
  caption: string;
  tags: string[];
  productName: string;
  thumbnailUrl: string;
  platform: Platform;
  accountId: string;
  accountLabel: string;
  plannedPublishDate: string;
  plannedPublishAt: string;
  duration: number;
  inspirationReference: WeeklyInspirationReference | null;
  productionRole: "master" | "platform_adaptation";
  status: ContentQueueItem["status"];
  queueItem: ContentQueueItem | null;
  estimatedCostCny: number | null;
  estimatedCostRange: { minCny: number; maxCny: number } | null;
  metrics: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    interactions: number;
    engagementRate: number;
    source: DisplayMetricSource;
  };
};

type UnifiedAccountRow = {
  accountId: string;
  accountLabel: string;
  platform: Platform;
  positioning: string;
  plannedCount: number;
  budgetCny: number | null;
  source: "connected" | "plan";
};

export type SmartBusinessDisplayModel = {
  revision: number;
  startsAt: string;
  endsAt: string;
  contents: UnifiedPlanContent[];
  masters: UnifiedPlanContent[];
  accounts: UnifiedAccountRow[];
  totals: {
    accountCount: number;
    originalCount: number;
    versionCount: number;
    durationSeconds: number;
    budgetMinCny: number;
    budgetMaxCny: number;
    budgetMidCny: number;
    completedCount: number;
    waitingReviewCount: number;
    blockedCount: number;
    views: number;
    interactions: number;
    publishedCount: number;
    engagementRate: number;
    performanceSource: DisplayMetricSource;
  };
  platforms: Array<{
    platform: Platform;
    plannedCount: number;
    views: number;
    interactions: number;
    engagementRate: number;
    source: DisplayMetricSource;
  }>;
};

const demoPerformanceBase: Record<Platform, { views: number; engagementRate: number }> = {
  youtube: { views: 2_600, engagementRate: 4.1 },
  tiktok: { views: 5_200, engagementRate: 6.8 },
  instagram: { views: 3_600, engagementRate: 5.5 },
  facebook: { views: 1_800, engagementRate: 3.4 },
  linkedin: { views: 1_200, engagementRate: 3.8 },
};

function deterministicSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function demoMetrics(platform: Platform, identity: string) {
  const seed = deterministicSeed(identity);
  const base = demoPerformanceBase[platform];
  const views = Math.round(base.views * (0.78 + (seed % 47) / 100));
  const engagementRate = Math.round((base.engagementRate + ((seed >> 3) % 15) / 10) * 10) / 10;
  const interactions = Math.round(views * engagementRate / 100);
  const likes = Math.round(interactions * 0.72);
  const comments = Math.round(interactions * 0.13);
  const shares = Math.max(0, interactions - likes - comments);
  return { views, likes, comments, shares, interactions, engagementRate, source: "demo" as const };
}

function contentThumbnailUrl(plan: VideoCreationPlan, queueItem: ContentQueueItem | null) {
  const previews = [queueItem?.preproduction, plan.preproduction];
  for (const preview of previews) {
    const storyboardFrame = preview?.materials.storyboard?.find(item => item.status === "ready" && item.materialPreviewUrl)?.materialPreviewUrl;
    if (storyboardFrame) return storyboardFrame;
    const readyMaterial = preview?.materials.items.find(item => item.type === "image" && item.status === "ready" && item.previewUrl)?.previewUrl;
    if (readyMaterial) return readyMaterial;
  }
  const thumbnailUrl = queueItem?.preproduction?.benchmark.thumbnailUrl
    || plan.preproduction?.benchmark.thumbnailUrl
    || plan.planningEvidence?.referenceThumbnailUrl
    || "";
  const sourceUrl = queueItem?.preproduction?.benchmark.sourceUrl
    || plan.preproduction?.benchmark.sourceUrl
    || plan.planningEvidence?.referenceSourceUrl
    || "";
  return thumbnailUrlWithSourceFallback(thumbnailUrl, sourceUrl);
}

export function buildSmartBusinessDisplayModel(data: DigitalEmployeeOverview, selectedAccountId = ""): SmartBusinessDisplayModel {
  const showcaseTotals = isSmartBusinessShowcaseEnabled() || isSmartBusinessWeeklyPlanPreviewEnabled()
    ? SMART_BUSINESS_SHOWCASE_WEEKLY_TOTALS
    : null;
  const showcaseWeeklyVideos = showcaseTotals ? smartBusinessShowcaseWeeklyVideos(data, true) : null;
  // Older model responses sometimes persisted a structured title or its accidental
  // string coercion. Only named text fields are displayable; never stringify facts.
  const displayText = (value: unknown, depth = 0): string => {
    if (typeof value === "string") {
      const normalized = value.trim();
      return /\[object\s+[^\]]+\]|^(?:undefined|null|NaN)$/i.test(normalized) ? "" : normalized;
    }
    if (!value || typeof value !== "object" || Array.isArray(value) || depth >= 3) return "";
    const record = value as Record<string, unknown>;
    for (const key of ["title", "text", "headline", "name", "label", "zh-CN", "zh", "en"]) {
      const candidate = displayText(record[key], depth + 1);
      if (candidate) return candidate;
    }
    return "";
  };
  const operatingContext = data.plan?.businessPackage?.operatingContext;
  const packagePlans = data.plan?.businessPackage?.tasks.find(task => task.templateId === "production")?.videoPlans || [];
  const goalPlans = data.goal?.videoPlans || [];
  const sourcePlans = packagePlans.length ? packagePlans : goalPlans;
  const runMatches = Boolean(data.run && data.run.goal_id === data.goal?.id && data.run.plan_id === data.plan?.id);
  const queue = (data.contentQueue?.items || []).filter(item => item.origin === "weekly_plan"
    && Boolean(data.goal?.id && data.plan?.id)
    && item.lineage.goalId === data.goal!.id && item.lineage.planId === data.plan!.id
    && (item.taskId ? runMatches && data.tasks.some(task => task.id === item.taskId && task.run_id === data.run!.id)
      : !item.projectIds.length && (!data.run || runMatches)));
  const deliveries = data.deliveries || [];
  const connectedIds = new Set((data.config?.publishingTargets || []).map(target => target.accountId));
  const operatingAccounts = operatingContext?.accounts || [];
  const accountById = new Map(operatingAccounts.map(account => [account.accountId, account]));
  const targetById = new Map((data.config?.publishingTargets || []).map(target => [target.accountId, target]));
  const claimedQueueIds = new Set<string>();

  const findQueueItem = (plan: VideoCreationPlan) => {
    if (plan.contentId) {
      const direct = queue.filter(item => item.contentId === plan.contentId);
      if (direct.length === 1) {
        claimedQueueIds.add(direct[0]!.id);
        return direct[0];
      }
      // A stable content ID must not borrow another date/account's production.
      return undefined;
    }
    const candidates = queue.filter(item => !claimedQueueIds.has(item.id)
      && !item.contentId
      && item.platform === plan.platform
      && (!plan.matrix?.accountId || item.accountId === plan.matrix.accountId)
      && (!plan.plannedPublishDate || item.plannedPublishDate === plan.plannedPublishDate));
    const candidate = candidates.length === 1 ? candidates[0] : undefined;
    if (candidate) claimedQueueIds.add(candidate.id);
    return candidate;
  };
  const sharedProductionItem = (plan: VideoCreationPlan) => {
    if (plan.productionRole !== "platform_adaptation") return undefined;
    const masters = sourcePlans.filter(candidate => candidate.productionRole === "master"
      && (plan.masterContentId ? candidate.contentId === plan.masterContentId
        : Boolean(plan.contentFamilyId && candidate.contentFamilyId === plan.contentFamilyId))
      && (!plan.contentFamilyId || candidate.contentFamilyId === plan.contentFamilyId)
      && (!plan.productId || candidate.productId === plan.productId));
    if (masters.length !== 1 || !masters[0]!.contentId) return undefined;
    const candidates = queue.filter(item => item.contentId === masters[0]!.contentId);
    return candidates.length === 1 ? candidates[0] : undefined;
  };

  const plannedContents = sourcePlans.map((plan, index): UnifiedPlanContent => {
    const directQueueItem = findQueueItem(plan) || null;
    const queueItem = directQueueItem || sharedProductionItem(plan) || null;
    const referencePlan = referencePlanForPublication(sourcePlans, plan);
    const accountId = plan.matrix?.accountId || directQueueItem?.accountId || `plan-${plan.platform}`;
    const account = accountById.get(accountId);
    const target = targetById.get(accountId);
    const productName = displayText(plan.productName) || displayText(directQueueItem?.productName) || displayText(data.config?.focusProducts) || "待绑定产品";
    const referenceTitle = displayText(plan.planningEvidence?.referenceTitle) || displayText(plan.preproduction?.benchmark.title)
      || displayText(referencePlan.planningEvidence?.referenceTitle) || displayText(referencePlan.preproduction?.benchmark.title);
    const factualFallback = [productName === "待绑定产品" ? "" : productName, referenceTitle].filter(Boolean).join("｜");
    const title = displayText(plan.publication?.title) || displayText(plan.theme) || factualFallback || `本周视频 ${index + 1}`;
    const identity = plan.contentId || `${plan.platform}-${plan.plannedPublishDate}-${title}-${index}`;
    // Sharing production never copies the master's platform performance/publication.
    const actual = directQueueItem ? performanceForQueueItem(directQueueItem, deliveries) : null;
    const fallback = demoMetrics(plan.platform, identity);
    const hasActual = Boolean(actual?.hasPlatformData);
    const views = hasActual ? actual?.views || 0 : fallback.views;
    const likes = hasActual ? actual?.likes || 0 : fallback.likes;
    const comments = hasActual ? actual?.comments || 0 : fallback.comments;
    const shares = hasActual ? actual?.shares || 0 : fallback.shares;
    const interactions = hasActual ? actual?.interactions || 0 : fallback.interactions;
    const engagementRate = hasActual ? actual?.engagementRate || 0 : fallback.engagementRate;
    return {
      id: identity,
      contentId: plan.contentId || identity,
      familyId: plan.contentFamilyId || plan.masterContentId || plan.contentId || identity,
      title: engagingContentTitle(title, index),
      caption: displayText(plan.publication?.caption),
      tags: plan.publication?.tags || [],
      productName,
      thumbnailUrl: contentThumbnailUrl(plan, queueItem),
      platform: plan.platform,
      accountId,
      accountLabel: account?.accountLabel || target?.accountLabel || `${data.config?.companyName || "企业"} · ${platformLabels[plan.platform]}`,
      plannedPublishDate: plan.plannedPublishDate || data.goal?.endsAt || "",
      plannedPublishAt: plan.plannedPublishAt || (plan.plannedPublishDate ? `${plan.plannedPublishDate}T18:00:00+08:00` : ""),
      duration: Number(plan.duration || 0),
      inspirationReference: inspirationReferenceForPlan(referencePlan),
      productionRole: plan.productionRole === "platform_adaptation" ? "platform_adaptation" : "master",
      status: queueItem?.status || "planned",
      queueItem,
      estimatedCostCny: plan.productionRole === "platform_adaptation"
        ? 0
        : Number(plan.estimatedCost || queueItem?.estimatedCostCny || 0) || null,
      estimatedCostRange: plan.estimatedCostRange ? {
        minCny: Number(plan.estimatedCostRange.minCny || 0),
        maxCny: Number(plan.estimatedCostRange.maxCny || 0),
      } : null,
      metrics: { views, likes, comments, shares, interactions, engagementRate, source: hasActual ? "real" : "demo" },
    };
  });
  const manualContents = (data.contentQueue?.items || []).filter(item => item.origin === 'manual' && Boolean(item.socialContentTaskId)).map((item, index): UnifiedPlanContent => {
    const actual = performanceForQueueItem(item, deliveries);
    const fallback = demoMetrics(item.platform, item.contentId || item.id);
    const hasActual = Boolean(actual?.hasPlatformData);
    return {
      id: item.id,
      contentId: item.contentId,
      familyId: item.contentId,
      title: item.title,
      caption: '',
      tags: [],
      productName: item.productName,
      thumbnailUrl: '',
      platform: item.platform,
      accountId: item.accountId || `manual-${item.platform}`,
      accountLabel: item.accountLabel || `${data.config?.companyName || '企业'} · ${platformLabels[item.platform]}`,
      plannedPublishDate: item.plannedPublishDate || data.goal?.endsAt || '',
      plannedPublishAt: item.plannedPublishDate ? `${item.plannedPublishDate}T18:00:00+08:00` : '',
      duration: item.outputSummary.durationSeconds || 0,
      inspirationReference: null,
      productionRole: 'master',
      status: item.status,
      queueItem: item,
      estimatedCostCny: item.estimatedCostCny,
      estimatedCostRange: null,
      metrics: {
        views: hasActual ? actual?.views || 0 : fallback.views,
        likes: hasActual ? actual?.likes || 0 : fallback.likes,
        comments: hasActual ? actual?.comments || 0 : fallback.comments,
        shares: hasActual ? actual?.shares || 0 : fallback.shares,
        interactions: hasActual ? actual?.interactions || 0 : fallback.interactions,
        engagementRate: hasActual ? actual?.engagementRate || 0 : fallback.engagementRate,
        source: hasActual ? 'real' : 'demo',
      },
    };
  });
  // Until weekly orders have real task bindings, show the tenant's actual content
  // executions instead of five generated placeholders that all appear unstarted.
  const mappedContents = queue.length ? plannedContents : manualContents.length ? manualContents : plannedContents;
  const showcaseContents = showcaseWeeklyVideos?.map((video, index): UnifiedPlanContent => {
    const base = mappedContents.length ? mappedContents[index % mappedContents.length]! : null;
    return {
      id: video.id,
      contentId: video.id,
      familyId: video.id,
      title: engagingContentTitle(video.title, index),
      caption: base?.caption || '',
      tags: base?.tags || [],
      productName: video.productName,
      thumbnailUrl: video.thumbnailUrl,
      platform: video.platform,
      accountId: video.accountId,
      accountLabel: video.accountLabel,
      plannedPublishDate: video.plannedPublishDate,
      plannedPublishAt: video.plannedPublishAt,
      duration: video.duration,
      inspirationReference: base?.inspirationReference || null,
      productionRole: 'master',
      status: video.status,
      queueItem: null,
      estimatedCostCny: video.estimatedCostCny,
      estimatedCostRange: { minCny: video.budgetMinCny, maxCny: video.budgetMaxCny },
      metrics: demoMetrics(video.platform, video.id),
    };
  }) || [];
  const allContents = showcaseContents.length ? showcaseContents : mappedContents;
  const contents = allContents.filter(item => !selectedAccountId || item.accountId === selectedAccountId);
  const masters = contents.filter(item => item.productionRole === "master");
  const groupedAccounts = new Map<string, UnifiedAccountRow>();
  for (const item of contents) {
    const operatingAccount = accountById.get(item.accountId);
    const current = groupedAccounts.get(item.accountId);
    if (current) current.plannedCount += 1;
    else groupedAccounts.set(item.accountId, {
      accountId: item.accountId,
      accountLabel: item.accountLabel,
      platform: item.platform,
      positioning: operatingAccount?.positioning || "本周计划经营账号",
      plannedCount: 1,
      budgetCny: operatingAccount?.budgetCny ?? null,
      source: connectedIds.has(item.accountId) ? "connected" : "plan",
    });
  }
  if (!contents.length) {
    for (const account of operatingAccounts.filter(item => !selectedAccountId || item.accountId === selectedAccountId)) {
      groupedAccounts.set(account.accountId, {
        accountId: account.accountId,
        accountLabel: account.accountLabel,
        platform: account.platform as Platform,
        positioning: account.positioning,
        plannedCount: account.contentCount,
        budgetCny: account.budgetCny,
        source: connectedIds.has(account.accountId) ? "connected" : "plan",
      });
    }
  }
  const accounts = [...groupedAccounts.values()];
  const itemBudgetMin = masters.reduce((sum, item) => sum + Number(item.estimatedCostRange?.minCny || 0), 0);
  const itemBudgetMax = masters.reduce((sum, item) => sum + Number(item.estimatedCostRange?.maxCny || 0), 0);
  const itemBudgetPoint = masters.reduce((sum, item) => sum + Number(item.estimatedCostCny || 0), 0);
  const budgetMinCny = showcaseContents.length ? itemBudgetMin : operatingContext?.budget.productionMinCny
    ?? itemBudgetMin;
  const budgetMaxCny = showcaseContents.length ? itemBudgetMax : operatingContext?.budget.productionMaxCny
    ?? itemBudgetMax;
  const fallbackBudget = showcaseContents.length ? itemBudgetPoint : operatingContext?.budget.productionCny
    ?? itemBudgetPoint;
  const normalizedMin = budgetMinCny || fallbackBudget;
  const normalizedMax = budgetMaxCny || fallbackBudget;
  const realAggregateViews = data.businessSnapshot?.social.views.value;
  const realAggregateInteractions = data.businessSnapshot
    ? [data.businessSnapshot.social.likes.value, data.businessSnapshot.social.comments.value, data.businessSnapshot.social.shares.value, data.businessSnapshot.social.saves.value]
      .filter((value): value is number => value !== null).reduce((sum, value) => sum + value, 0)
    : null;
  const actualPublishedCount = data.businessSnapshot?.content.publishedPosts.value;
  const useRealAggregate = realAggregateViews !== null && realAggregateViews !== undefined;
  const views = useRealAggregate ? realAggregateViews : contents.reduce((sum, item) => sum + item.metrics.views, 0);
  const interactions = useRealAggregate && realAggregateInteractions !== null
    ? realAggregateInteractions
    : contents.reduce((sum, item) => sum + item.metrics.interactions, 0);
  const publishedCount = actualPublishedCount !== null && actualPublishedCount !== undefined
    ? actualPublishedCount
    : contents.filter(item => item.status === "completed" && item.queueItem?.contentId === item.contentId).length;
  const platforms = platformOptions.map(platform => {
    const rows = contents.filter(item => item.platform === platform);
    const platformSnapshot = data.businessSnapshot?.social.platformBreakdown.find(item => item.platform.toLowerCase() === platform);
    const hasReal = platformSnapshot?.views !== null && platformSnapshot?.views !== undefined;
    const platformViews = hasReal ? platformSnapshot?.views || 0 : rows.reduce((sum, item) => sum + item.metrics.views, 0);
    const platformInteractions = hasReal
      ? [platformSnapshot?.likes, platformSnapshot?.comments, platformSnapshot?.shares].filter((value): value is number => value !== null && value !== undefined).reduce((sum, value) => sum + value, 0)
      : rows.reduce((sum, item) => sum + item.metrics.interactions, 0);
    return {
      platform,
      plannedCount: rows.length,
      views: platformViews,
      interactions: platformInteractions,
      engagementRate: platformViews ? platformInteractions / platformViews * 100 : 0,
      source: hasReal ? "real" as const : "demo" as const,
    };
  });
  return {
    revision: data.plan?.businessPackage?.revision || data.goal?.version || 1,
    startsAt: operatingContext?.cycle?.startsAt || data.goal?.startsAt || "",
    endsAt: operatingContext?.cycle?.endsAt || data.goal?.endsAt || "",
    contents,
    masters,
    accounts,
    totals: {
      accountCount: accounts.length,
      originalCount: operatingContext?.outputs.originalCount ?? masters.length,
      versionCount: contents.length
        || operatingContext?.outputs.platformVersionCount
        || operatingContext?.outputs.count
        || 0,
      durationSeconds: contents.reduce((sum, item) => sum + item.duration, 0)
        || operatingContext?.outputs.totalDurationSeconds
        || 0,
      budgetMinCny: normalizedMin,
      budgetMaxCny: normalizedMax,
      budgetMidCny: fallbackBudget || (normalizedMin + normalizedMax) / 2,
      completedCount: contents.filter(item => item.status === "completed").length,
      waitingReviewCount: contents.filter(item => item.status === "waiting_review").length,
      blockedCount: contents.filter(item => item.status === "blocked").length,
      views,
      interactions,
      publishedCount,
      engagementRate: views ? interactions / views * 100 : 0,
      performanceSource: useRealAggregate ? "real" : "demo",
    },
    platforms,
  };
}

type QueuePerformance = {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  interactions: number | null;
  engagementRate: number | null;
  hasPlatformData: boolean;
};

function deliveryNumber(card: DeliveryResource, pattern: RegExp) {
  const value = card.metrics.find(metric => pattern.test(metric.label))?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function performanceForQueueItem(item: ContentQueueItem, deliveries: DeliveryResource[]): QueuePerformance {
  const ids = new Set([item.taskId, item.socialContentTaskId, item.contentId].filter(Boolean));
  const related = deliveries.filter(card => ids.has(card.taskId) || card.taskIds.some(id => ids.has(id)));
  const sum = (pattern: RegExp) => {
    const values = related.map(card => deliveryNumber(card, pattern)).filter((value): value is number => value !== null);
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  };
  const views = sum(/播放|浏览|观看|view/i) ?? sum(/曝光|reach/i);
  const likes = sum(/点赞|like/i);
  const comments = sum(/评论|comment/i);
  const shares = sum(/分享|share/i);
  const saves = sum(/收藏|save/i);
  const interactionValues = [likes, comments, shares, saves].filter((value): value is number => value !== null);
  const interactions = interactionValues.length ? interactionValues.reduce((total, value) => total + value, 0) : null;
  return {
    views, likes, comments, shares, saves, interactions,
    engagementRate: views && interactions !== null ? interactions / views * 100 : null,
    hasPlatformData: views !== null || interactions !== null,
  };
}
